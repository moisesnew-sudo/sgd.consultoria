/**
 * Contratos da camada de adapters de integração (Transferegov, SEI, CGLOG).
 *
 * Dois níveis de contrato coexistem:
 * 1. IntegrationAdapter — funções síncronas puras para normalização de webhooks (Fase 2.2);
 * 2. GovernmentIntegrationAdapter — extensão ativa com autenticação, fetch, validação e
 *    sincronização para comunicação real com APIs governamentais (Fase E1.1).
 *
 * A interface original é preservada para retrocompatibilidade.
 */

/** Evento normalizado e padronizado para os três sistemas. */
export interface NormalizedIntegrationEvent {
  /** Código do sistema (transferegov | sei | cglog) — preenchido pelo adapter, usado pelo integrationSync e logs. */
  systemCode: string;
  /** Tipo do evento recebido (ex.: demand.updated) ou 'unknown'. */
  eventType: string;
  /** Número da proposta no sistema externo (quando existir). */
  proposalNumber?: string;
  /** Identificador externo principal do sistema (convenio/contrato, processo, protocolo). */
  externalId?: string;
  /** Status externo normalizado (CAIXA ALTA, sem acentos) — usado no lookup de integration_status_mapping. */
  externalStatus?: string;
  /** Prazo extraído do payload, em ISO 8601 (quando existir e for data válida). */
  deadline?: string;
  /** Dados complementares preservados para auditoria (ex.: datas do SEI). */
  extra?: Record<string, unknown>;
}

/** Contrato obrigatório de todo adapter de sistema externo. */
export interface IntegrationAdapter {
  /** Código canônico do sistema no SGD (chave em integration_systems). */
  system: string;
  /** Normaliza um payload bruto de webhook em um NormalizedIntegrationEvent. */
  normalize(payload: unknown): NormalizedIntegrationEvent;
}

// ---------------------------------------------------------------------------
// Fase E1.1 — Contratos para integrações governamentais reais
// ---------------------------------------------------------------------------

/** Configuração carregada de integration_systems.config + environment variables. */
export interface AdapterConfig {
  /** URL base da API externa (ex.: https://api.transferegov.gov.br). */
  baseUrl?: string;
  /** Chave de ambiente que armazena o segredo/token (ex.: TRANSFEREGOV_API_KEY). */
  secretEnvKey?: string;
  /** Timeout em milissegundos para requisições HTTP (padrão: 30000). */
  timeoutMs?: number;
  /** Número máximo de tentativas em caso de falha transitória (padrão: 3). */
  maxRetries?: number;
  /** Intervalo base em ms para backoff exponencial (padrão: 1000). */
  retryBaseDelayMs?: number;
  /** Configurações adicionais específicas do sistema. */
  extra?: Record<string, unknown>;
}

/** Resultado de uma requisição HTTP externa padronizada. */
export interface ExternalApiResponse {
  /** HTTP status code da resposta. */
  status: number;
  /** Corpo da resposta parsed como JSON (ou null se não for JSON). */
  data: unknown;
  /** Headers de resposta relevantes. */
  headers?: Record<string, string>;
  /** Duração da requisição em milissegundos. */
  durationMs: number;
}

/** Resultado de uma operação de sincronização ativa (pull). */
export interface SyncPullResult {
  /** Se a operação foi bem-sucedida. */
  success: boolean;
  /** Eventos normalizados resultantes da sincronização. */
  events: NormalizedIntegrationEvent[];
  /** Quantidade de registros obtidos do sistema externo. */
  fetchedCount: number;
  /** Quantidade de eventos normalizados com sucesso. */
  normalizedCount: number;
  /** Mensagem descritiva do resultado. */
  message?: string;
  /** Erro ocorrido (quando success = false). */
  error?: string;
  /** Último status HTTP obtido na consulta (0 = erro de rede/baseUrl; null = sem HTTP). */
  httpStatus?: number | null;
  /** Se o erro foi de autenticação (401/403). */
  authError?: boolean;
  /** Duração total da operação em ms. */
  durationMs: number;
}

/**
 * Contrato estendido para adapters de integrações governamentais reais.
 *
 * Complementa o IntegrationAdapter com operações ativas de comunicação:
 * autenticação, busca de dados, validação de payload e sincronização.
 *
 * Cada sistema (Transferegov, SEI, CGLOG) implementa este contrato com
 * suas especificidades de API.
 *
 * IMPORTANTE: Não armazenamos tokens em banco. A autenticação utiliza
 * environment variables e secrets gerenciados pelo deployment.
 */
export interface GovernmentIntegrationAdapter extends IntegrationAdapter {
  /** Código canônico do sistema. */
  readonly system: string;

  /**
   * Realiza autenticação com o sistema externo e retorna o token/credencial.
   * Utiliza variáveis de ambiente para secrets (nunca armazenados em banco).
   * @param config Configuração do sistema (integration_systems.config).
   * @returns Credencial autenticada (token, sessão, etc.) ou null se não requer auth.
   */
  authenticate(config: AdapterConfig): Promise<string | null>;

  /**
   * Busca dados no sistema externo (pull de propostas, processos, eventos).
   * @param config Configuração do sistema.
   * @param credential Credencial obtida via authenticate().
   * @param params Parâmetros de busca (proposta, período, status, etc.).
   * @returns Resposta HTTP padronizada.
   */
  fetch(config: AdapterConfig, credential: string | null, params: Record<string, unknown>): Promise<ExternalApiResponse>;

  /**
   * Valida se um payload recebido (via webhook ou manual) está dentro do contrato esperado.
   * @param payload Payload bruto recebido.
   * @returns true se válido, ou string com descrição do erro.
   */
  validate(payload: unknown): true | string;

  /**
   * Executa uma sincronização completa: autentica, busca, normaliza e retorna eventos.
   * Método principal para operações de pull ativo.
   * @param config Configuração do sistema.
   * @param params Parâmetros da sincronização.
   * @returns Resultado da sincronização com eventos normalizados.
   */
  sync(config: AdapterConfig, params: Record<string, unknown>): Promise<SyncPullResult>;
}

/**
 * Achata o payload, mesclando envelope comum ({ event, data | demand | payload })
 * com o nível raiz — campos mais específicos (aninhados) têm precedência.
 */
export function flattenPayload(payload: unknown): Record<string, any> {
  const out: Record<string, any> = {};
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const root = payload as Record<string, any>;
    Object.assign(out, root);
    for (const key of ['data', 'demand', 'demanda', 'payload', 'evento', 'event']) {
      const sub = root[key];
      if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
        Object.assign(out, sub);
      }
    }
  }
  return out;
}

/**
 * Extrai o primeiro valor não vazio dentre as chaves candidatas.
 * Aceita string ou número; nunca lança; retorna undefined se ausente.
 */
export function pickString(payload: Record<string, any>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

/**
 * Normaliza um status externo: CAIXA ALTA, sem acentos, separadores virando underscore.
 * Ex.: 'em análise' -> 'EM_ANALISE', 'APROVADO' -> 'APROVADO'.
 */
export function normalizeExternalStatus(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  const normalized = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || undefined;
}

/** Converte valor em data ISO 8601; retorna undefined se ausente ou inválida. */
export function toIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/** Extrai o tipo de evento do payload (campo event/tipo_evento) ou 'unknown'. */
export function extractEventType(payload: Record<string, any>): string {
  return pickString(payload, ['event', 'tipo_evento', 'tipoEvento']) || 'unknown';
}

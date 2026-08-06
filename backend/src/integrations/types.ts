/**
 * Contratos da camada de adapters de integração (Transferegov, SEI, CGLOG).
 * Adapters são funções síncronas puras: transformam o payload bruto do webhook
 * em um evento normalizado, pronto para consumo pelo integrationSync (Fase 2.2).
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

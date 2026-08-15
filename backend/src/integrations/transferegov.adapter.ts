import {
  IntegrationAdapter,
  GovernmentIntegrationAdapter,
  NormalizedIntegrationEvent,
  AdapterConfig,
  ExternalApiResponse,
  SyncPullResult,
  flattenPayload,
  pickString,
  normalizeExternalStatus,
  toIsoDate,
  extractEventType,
} from './types.js';
import { httpClient, readSecret } from './httpClient.js';
import { logger } from '../lib/logger.js';

/**
 * Adapter de integração com o Transferegov.
 *
 * A integração ativa usa a API Pública de Gestão de Parcerias do Governo Federal
 * (base oficial: https://api-publica.transferegov.gestao.gov.br/parcerias).
 *
 * Contrato real (confirmado por censo de produção, 89.022 parcerias):
 * - GET /parcerias/parceria?pagina={n}&tamanho_da_pagina={m}  (pagina inicia em 1; m <= 200);
 * - Resposta: { data: [...], total_pages, total_items, page_number, page_size };
 * - Identidade: cd_parceria é o identificador externo (NÃO usar nu_externo);
 * - Status: in_situacao_parceria (8 estados reais);
 * - Financeiro: vl_total_planejamento_gastos (NÃO usar nr_vlr_total, vazio em produção);
 * - Autenticação: authType = none (API pública, sem Authorization / X-API-Key / secret).
 *
 * O adapter síncrono (transferegovAdapter) permanece responsável pela normalização
 * de webhooks (Fase 2.2) e mantém o contrato legado de proposta/convênio.
 */

const SYSTEM_CODE = 'transferegov';

/** Base URL oficial da API Pública de Gestão de Parcerias (Transferegov). */
export const PARTNERSHIP_BASE_URL = 'https://api-publica.transferegov.gestao.gov.br/parcerias';

/** Recurso de parcerias da API (GET /parcerias/parceria). */
const PARTNERSHIP_ENDPOINT = '/parceria';

/** Recurso de propostas da API (GET /parcerias/proposta). */
const PROPOSAL_ENDPOINT = '/proposta';

/** Tamanho máximo de página aceito pela API. */
const MAX_PAGE_SIZE = 200;
/** Tamanho de página padrão. */
const DEFAULT_PAGE_SIZE = 200;
/** Primeira página da API. */
const FIRST_PAGE = 1;

const PROPOSAL_KEYS = ['proposal_number', 'numero_proposta', 'numeroProposta', 'proposta', 'id_proposta'];
const CONTRACT_KEYS = ['contract_number', 'numero_convenio', 'numeroConvenio', 'convenio', 'contrato'];
const STATUS_KEYS = ['status', 'situacao'];
const DEADLINE_KEYS = ['deadline', 'prazo', 'data_limite', 'dataLimite', 'data_vencimento', 'dataVencimento'];

const ID_PARCERIA_KEYS = ['id_parceria'];
const CD_PARCERIA_KEYS = ['cd_parceria'];
const ID_PROPOSTA_KEYS = ['id_proposta'];
const NU_EXTERNO_KEYS = ['nu_externo'];
const PARTNERSHIP_STATUS_KEYS = ['in_situacao_parceria', 'situacao_parceria', 'situacao', 'status'];
const FINANCIAL_KEYS = ['vl_total_planejamento_gastos', 'vlTotalPlanejamentoGastos'];

/** Caminho do endpoint de data de atualização da base oficial (GET /parcerias/data-atualizacao). */
const DATA_ATUALIZACAO_PATH = '/data-atualizacao';
/** Chaves candidatas do campo de data de atualização na resposta do endpoint. */
const DATA_ATUALIZACAO_KEYS = [
  'data_ultima_atualizacao',
  'dataUltimaAtualizacao',
  'data_atualizacao',
  'dataAtualizacao',
  'atualizado_em',
  'atualizadoEm',
  'data',
];

/**
 * Adapter síncrono puro — normalização de webhooks (compatível com Fase 2.2).
 */
export const transferegovAdapter: IntegrationAdapter = {
  system: SYSTEM_CODE,

  normalize(payload: unknown): NormalizedIntegrationEvent {
    const p = flattenPayload(payload);
    const proposalNumber = pickString(p, PROPOSAL_KEYS);
    const contractNumber = pickString(p, CONTRACT_KEYS);
    const rawStatus = pickString(p, STATUS_KEYS);

    return {
      systemCode: this.system,
      eventType: extractEventType(p),
      proposalNumber,
      externalId: contractNumber,
      externalStatus: normalizeExternalStatus(rawStatus),
      deadline: toIsoDate(pickString(p, DEADLINE_KEYS)),
      extra: {
        ...(contractNumber ? { contractNumber } : {}),
        ...(rawStatus ? { rawStatus } : {}),
      },
    };
  },
};

/**
 * Constrói a URL do recurso de parcerias a partir da base configurada.
 * Aceita a base oficial (…/parcerias) ou uma base sem o sufixo do recurso.
 */
function buildPartnershipUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/parcerias')) {
    return `${base}${PARTNERSHIP_ENDPOINT}`;
  }
  return `${base}/parcerias${PARTNERSHIP_ENDPOINT}`;
}

/** Preserva o valor original de um campo numérico (sem converter o tipo). */
function pickOriginalValue(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/** Constrói a URL do endpoint de data de atualização da base (GET /parcerias/data-atualizacao). */
function buildDataAtualizacaoUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/parcerias')) {
    return `${base}${DATA_ATUALIZACAO_PATH}`;
  }
  return `${base}/parcerias${DATA_ATUALIZACAO_PATH}`;
}

/** Constrói a URL do recurso de propostas (GET /parcerias/proposta). */
function buildProposalUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/parcerias')) {
    return `${base}${PROPOSAL_ENDPOINT}`;
  }
  return `${base}/parcerias${PROPOSAL_ENDPOINT}`;
}

/** Resultado da consulta ao endpoint de data de atualização da base. */
export interface TransferegovDataAtualizacaoResult {
  /** Se a data de atualização foi obtida com sucesso (HTTP 200 + campo presente). */
  ok: boolean;
  /** Valor bruto do campo de data (string) quando presente. */
  value?: string;
  /** Motivo da falha (rede/HTTP/formato). */
  error?: string;
  /** Status HTTP da resposta (0 = erro de rede/baseUrl; null = sem HTTP). */
  httpStatus: number | null;
}

/**
 * Consulta a data de atualização da base oficial do Transferegov
 * (GET /parcerias/data-atualizacao), usada pelo motor de snapshot para
 * otimizar a execução (pular sincronizações sem alterações).
 *
 * Função standalone (NÃO altera o contrato de GovernmentIntegrationAdapter).
 * A validação de formato da data (new Date) fica a cargo do módulo de snapshot.
 */
export async function fetchTransferegovDataAtualizacao(
  config: AdapterConfig,
  credential?: string | null,
): Promise<TransferegovDataAtualizacaoResult> {
  const baseUrl = config.baseUrl;
  if (!baseUrl) {
    return { ok: false, error: 'BaseUrl não configurada para o Transferegov', httpStatus: null };
  }

  const headers: Record<string, string> = {};
  if (credential) {
    const authType = (config.extra?.authType as string) ?? 'none';
    if (authType === 'oauth2') {
      headers['Authorization'] = `Bearer ${credential}`;
    } else if (authType === 'api_key') {
      headers['X-API-Key'] = credential;
    }
  }

  try {
    const response = await httpClient(config, {
      url: buildDataAtualizacaoUrl(baseUrl),
      method: 'GET',
      headers,
    });

    if (response.status === 0) {
      return {
        ok: false,
        error: 'Falha de rede ou timeout ao consultar a data de atualização do Transferegov',
        httpStatus: 0,
      };
    }
    if (response.status !== 200) {
      return {
        ok: false,
        error: `HTTP ${response.status} na consulta de data de atualização do Transferegov`,
        httpStatus: response.status,
      };
    }

    const data = response.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        ok: false,
        error: 'Resposta de data de atualização estruturalmente inválida',
        httpStatus: response.status,
      };
    }

    const value = pickOriginalValue(data as Record<string, unknown>, DATA_ATUALIZACAO_KEYS);
    if (typeof value !== 'string' || value.trim() === '') {
      return {
        ok: false,
        error: 'Campo de data de atualização ausente ou vazio na resposta',
        httpStatus: response.status,
      };
    }

    return { ok: true, value: value.trim(), httpStatus: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      httpStatus: 0,
    };
  }
}

/**
 * Extrai o id_proposta de um registro de proposta (número inteiro ou string numérica).
 * Retorna null quando ausente, vazio ou em formato não numérico.
 */
function extractProposalId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = (raw as Record<string, unknown>).id_proposta;
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return String(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

/**
 * Resultado da coleta paginada de propostas (GET /parcerias/proposta).
 * Estrutura mínima — NÃO retém os payloads completos de proposta.
 */
export interface TransferegovProposalsResult {
  /** Mapa id_proposta → vl_total_planejamento_gastos (número) ou null (sem valor na API). */
  valuesByProposalId: Map<string, number | null>;
  /** Páginas processadas. */
  pagesProcessed: number;
  /** total_items declarado pela API (null se a coleta falhou antes do envelope). */
  totalItems: number | null;
  /** Total de registros obtidos. */
  fetchedCount: number;
  /** Propostas com vl_total_planejamento_gastos numérico válido. */
  withValue: number;
  /** Propostas com vl_total_planejamento_gastos nulo. */
  withoutValue: number;
  /** Status HTTP da última resposta (0 = erro de rede/baseUrl; null = sem HTTP). */
  httpStatus: number | null;
  /** Duração total da coleta. */
  durationMs: number;
  /** Propostas com id_proposta duplicado (a coleta falha nesse caso). */
  duplicatedCount: number;
  /** Propostas com vl_total_planejamento_gastos malformado (a coleta falha nesse caso). */
  invalidValueCount: number;
  /** true quando todas as validações de contrato foram satisfeitas. */
  success: boolean;
  /** Erro de contrato/rede/HTTP quando success=false. */
  error?: string;
  /** Status 401/403. */
  authError?: boolean;
}

/**
 * Coleta paginada do recurso de propostas (GET /parcerias/proposta), retendo apenas
 * o valor financeiro por id_proposta (Map) — sem manter payloads completos em memória.
 *
 * Validações de contrato:
 * - envelope com campo data (array);
 * - total_pages inteiro >= 1 e total_items inteiro >= 0 (primeira página);
 * - page_number coerente com a página solicitada (quando presente);
 * - page_size inteiro em 1..200 (quando presente);
 * - página vazia apenas na última página;
 * - total coletado == total_items;
 * - id_proposta obrigatório e único (duplicidade viola o contrato);
 * - vl_total_planejamento_gastos numérico válido ou null (nada além disso).
 *
 * Qualquer violação impede que a coleta seja considerada completa.
 * O retry é delegado integralmente ao HttpClient existente.
 */
export async function collectTransferegovProposals(
  config: AdapterConfig,
  credential?: string | null,
): Promise<TransferegovProposalsResult> {
  const startedAt = Date.now();
  const baseUrl = config.baseUrl;

  const valuesByProposalId = new Map<string, number | null>();
  let page = FIRST_PAGE;
  let totalPages: number | null = null;
  let totalItems: number | null = null;
  let pagesProcessed = 0;
  let fetchedCount = 0;
  let withValue = 0;
  let withoutValue = 0;
  let invalidValueCount = 0;
  let duplicatedCount = 0;
  let httpStatus: number | null = null;

  const buildResult = (partial: Partial<TransferegovProposalsResult>): TransferegovProposalsResult => ({
    valuesByProposalId,
    pagesProcessed,
    totalItems,
    fetchedCount,
    withValue,
    withoutValue,
    httpStatus,
    durationMs: Date.now() - startedAt,
    duplicatedCount,
    invalidValueCount,
    success: false,
    ...partial,
  });

  if (!baseUrl) {
    return buildResult({ error: 'BaseUrl não configurada para o Transferegov', httpStatus: 0 });
  }

  const headers: Record<string, string> = {};
  if (credential) {
    const authType = (config.extra?.authType as string) ?? 'none';
    if (authType === 'oauth2') {
      headers['Authorization'] = `Bearer ${credential}`;
    } else if (authType === 'api_key') {
      headers['X-API-Key'] = credential;
    }
  }

  while (true) {
    const resp = await httpClient(config, {
      url: `${buildProposalUrl(baseUrl)}?pagina=${page}&tamanho_da_pagina=${DEFAULT_PAGE_SIZE}`,
      method: 'GET',
      headers,
    });

    if (resp.status === 0) {
      return buildResult({
        error: 'Falha de rede ou timeout ao consultar o Transferegov',
        httpStatus: 0,
      });
    }
    if (resp.status !== 200) {
      return buildResult({
        error: `HTTP ${resp.status} na consulta ao Transferegov`,
        httpStatus: resp.status,
        authError: resp.status === 401 || resp.status === 403,
      });
    }
    httpStatus = resp.status;

    const envelope = resp.data;
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      Array.isArray(envelope) ||
      !Array.isArray((envelope as Record<string, unknown>).data)
    ) {
      return buildResult({
        error: 'Resposta do Transferegov estruturalmente inválida: envelope esperado com campo data (array)',
      });
    }

    const rec = envelope as Record<string, unknown>;
    const data = rec.data as unknown[];

    if (page === FIRST_PAGE) {
      if (!Number.isInteger(rec.total_pages) || (rec.total_pages as number) < 1) {
        return buildResult({
          error: 'Resposta do Transferegov estruturalmente inválida: total_pages deve ser inteiro >= 1',
        });
      }
      if (!Number.isInteger(rec.total_items) || (rec.total_items as number) < 0) {
        return buildResult({
          error: 'Resposta do Transferegov estruturalmente inválida: total_items deve ser inteiro >= 0',
        });
      }
      totalPages = rec.total_pages as number;
      totalItems = rec.total_items as number;
    }

    if (
      rec.page_number !== undefined &&
      rec.page_number !== null &&
      !(Number.isInteger(rec.page_number) && rec.page_number === page)
    ) {
      return buildResult({
        error: `Resposta do Transferegov estruturalmente inválida: page_number ${String(rec.page_number)} não corresponde à página ${page}`,
      });
    }
    if (
      rec.page_size !== undefined &&
      rec.page_size !== null &&
      (!Number.isInteger(rec.page_size) || (rec.page_size as number) < 1 || (rec.page_size as number) > MAX_PAGE_SIZE)
    ) {
      return buildResult({
        error: `Resposta do Transferegov estruturalmente inválida: page_size ${String(rec.page_size)} fora do intervalo 1..${MAX_PAGE_SIZE}`,
      });
    }

    if (data.length === 0) {
      if (totalPages !== null && page < totalPages) {
        return buildResult({
          error: `Resposta do Transferegov estruturalmente inválida: página ${page} vazia antes de total_pages`,
        });
      }
      break;
    }

    for (const raw of data) {
      const id = extractProposalId(raw);
      if (!id) {
        return buildResult({
          error: 'Contrato do Transferegov violado: id_proposta ausente ou vazio',
        });
      }
      if (valuesByProposalId.has(id)) {
        duplicatedCount++;
        return buildResult({
          error: `Contrato do Transferegov violado: id_proposta duplicado (${id})`,
        });
      }

      const value = (raw as Record<string, unknown>).vl_total_planejamento_gastos;
      if (value === null || value === undefined) {
        valuesByProposalId.set(id, null);
        withoutValue++;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        valuesByProposalId.set(id, value);
        withValue++;
      } else if (typeof value === 'string' && /^[-+]?\d+(\.\d+)?$/.test(value.trim())) {
        valuesByProposalId.set(id, Number(value));
        withValue++;
      } else {
        invalidValueCount++;
        return buildResult({
          error: `Contrato do Transferegov violado: vl_total_planejamento_gastos inválido (id_proposta ${id})`,
        });
      }
      fetchedCount++;
    }
    pagesProcessed++;

    if (totalPages !== null && page >= totalPages) {
      break;
    }
    page++;
  }

  if (totalItems !== null && fetchedCount !== totalItems) {
    return buildResult({
      error: `Incoerência de paginação no Transferegov: total_items=${totalItems} mas registros obtidos=${fetchedCount}`,
    });
  }

  return buildResult({ success: true });
}

/**
 * Adapter ativo de integração com o Transferegov (Fase E1.1 / A7.2).
 *
 * Implementa GovernmentIntegrationAdapter com:
 * - Autenticação authType = none (API pública, sem credencial);
 * - Consulta paginada ao recurso /parceria;
 * - Validação de payloads do contrato real de parceria;
 * - Sincronização pull de dados até total_pages com coerência de total_items.
 */
export const transferegovGovAdapter: GovernmentIntegrationAdapter = {
  system: SYSTEM_CODE,

  normalize(payload: unknown): NormalizedIntegrationEvent {
    const p = flattenPayload(payload);

    // Contrato real da API Pública de Gestão de Parcerias.
    const cdParceria = pickString(p, CD_PARCERIA_KEYS);
    const idParceria = pickString(p, ID_PARCERIA_KEYS);
    const idProposta = pickString(p, ID_PROPOSTA_KEYS);
    const nuExterno = pickString(p, NU_EXTERNO_KEYS);
    const partnershipStatus = pickString(p, PARTNERSHIP_STATUS_KEYS);

    // Compatibilidade com webhooks legados (proposta/convênio).
    const proposalNumber = idProposta ?? pickString(p, PROPOSAL_KEYS);
    const contractNumber = pickString(p, CONTRACT_KEYS);
    const statusValue = partnershipStatus ?? pickString(p, STATUS_KEYS);

    const financialValue = pickOriginalValue(p, FINANCIAL_KEYS);

    return {
      systemCode: SYSTEM_CODE,
      eventType: extractEventType(p),
      proposalNumber,
      externalId: cdParceria ?? contractNumber ?? idParceria,
      externalStatus: normalizeExternalStatus(statusValue),
      deadline: toIsoDate(pickString(p, DEADLINE_KEYS)),
      extra: {
        ...(idParceria ? { idParceria } : {}),
        ...(idProposta ? { idProposta } : {}),
        ...(cdParceria ? { cdParceria } : {}),
        ...(nuExterno ? { nuExterno } : {}),
        ...(contractNumber ? { contractNumber } : {}),
        ...(statusValue ? { rawStatus: statusValue } : {}),
        ...(financialValue !== undefined ? { vlTotalPlanejamentoGastos: financialValue } : {}),
      },
    };
  },

  async authenticate(config: AdapterConfig): Promise<string | null> {
    const authType = (config.extra?.authType as string) ?? 'none';

    // API pública: nenhum header de autorização, nenhum secret é lido ou exigido.
    if (authType === 'none') {
      logger.info('Transferegov: API pública de parcerias — autenticação não requerida (authType=none)', {
        system: SYSTEM_CODE,
      });
      return null;
    }

    const secretKey = config.secretEnvKey;
    if (!secretKey) {
      logger.info('Transferegov: sem secret_env_key configurado — modo sem autenticação', { system: SYSTEM_CODE });
      return null;
    }

    const secret = readSecret(secretKey);
    if (!secret) {
      logger.warn('Transferegov: secret não disponível — autenticação ignorada', { system: SYSTEM_CODE });
      return null;
    }

    if (authType === 'oauth2') {
      const tokenUrl = (config.extra?.tokenUrl as string) ?? `${config.baseUrl}/oauth/token`;
      const clientId = (config.extra?.clientId as string) ?? '';

      try {
        const response = await httpClient(config, {
          url: tokenUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: secret,
          }).toString(),
          silent: true,
        });

        if (response.status === 200 && response.data && typeof response.data === 'object') {
          const token = (response.data as Record<string, unknown>).access_token;
          if (typeof token === 'string') {
            logger.info('Transferegov: autenticação OAuth2 concluída', { system: SYSTEM_CODE });
            return token;
          }
        }

        logger.error('Transferegov: falha na autenticação OAuth2', {
          system: SYSTEM_CODE,
          status: response.status,
        });
        return null;
      } catch (error) {
        logger.error('Transferegov: erro na autenticação OAuth2', {
          system: SYSTEM_CODE,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }

    return secret;
  },

  async fetch(config: AdapterConfig, credential: string | null, params: Record<string, unknown>): Promise<ExternalApiResponse> {
    const baseUrl = config.baseUrl;
    if (!baseUrl) {
      return { status: 0, data: null, durationMs: 0 };
    }

    const parsedPage = Number(params.pagina);
    const pagina = Number.isFinite(parsedPage) && parsedPage >= FIRST_PAGE ? Math.floor(parsedPage) : FIRST_PAGE;

    const requestedSize = Number(params.tamanho_da_pagina ?? params.tamanhoDaPagina);
    const tamanhoDaPagina = Number.isFinite(requestedSize) && requestedSize > 0
      ? Math.min(Math.floor(requestedSize), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const url = new URL(buildPartnershipUrl(baseUrl));
    url.searchParams.set('pagina', String(pagina));
    url.searchParams.set('tamanho_da_pagina', String(tamanhoDaPagina));

    const headers: Record<string, string> = {};
    if (credential) {
      const authType = (config.extra?.authType as string) ?? 'none';
      if (authType === 'oauth2') {
        headers['Authorization'] = `Bearer ${credential}`;
      } else if (authType === 'api_key') {
        headers['X-API-Key'] = credential;
      }
    }

    return httpClient(config, { url: url.toString(), method: 'GET', headers });
  },

  validate(payload: unknown): true | string {
    if (payload === null || payload === undefined) {
      return 'Payload não pode ser nulo ou indefinido';
    }
    if (typeof payload !== 'object') {
      return 'Payload deve ser um objeto';
    }
    if (Array.isArray(payload)) {
      return 'Payload não pode ser um array';
    }

    const p = flattenPayload(payload);
    const partnershipId = pickString(p, [...CD_PARCERIA_KEYS, ...ID_PARCERIA_KEYS]);
    const proposalNumber = pickString(p, PROPOSAL_KEYS);
    const contractNumber = pickString(p, CONTRACT_KEYS);

    if (!partnershipId && !proposalNumber && !contractNumber) {
      return 'Payload deve conter cd_parceria, id_parceria, número de proposta ou convênio';
    }

    const status = pickString(p, PARTNERSHIP_STATUS_KEYS);
    if (status) {
      const normalized = normalizeExternalStatus(status);
      if (!normalized) {
        return 'Status fornecido é inválido após normalização';
      }
    }

    return true;
  },

  async sync(config: AdapterConfig, params: Record<string, unknown>): Promise<SyncPullResult> {
    const startedAt = Date.now();

    const maxRecords = typeof params.maxRecords === 'number' && params.maxRecords > 0
      ? Math.floor(params.maxRecords)
      : undefined;
    const pageSize = maxRecords ? Math.min(maxRecords, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

    try {
      const credential = await this.authenticate(config);

      const events: NormalizedIntegrationEvent[] = [];
      let fetchedCount = 0;
      let page = FIRST_PAGE;
      let totalPages: number | null = null;
      let totalItems: number | null = null;

      while (true) {
        const fetchResult = await this.fetch(config, credential, {
          pagina: page,
          tamanho_da_pagina: pageSize,
        });

        if (fetchResult.status === 0) {
          const error = config.baseUrl
            ? 'Falha de rede ou timeout ao consultar o Transferegov'
            : 'BaseUrl não configurada para o Transferegov';
          return {
            success: false,
            events,
            fetchedCount,
            normalizedCount: events.length,
            error,
            httpStatus: 0,
            durationMs: Date.now() - startedAt,
          };
        }

        if (fetchResult.status !== 200) {
          return {
            success: false,
            events,
            fetchedCount,
            normalizedCount: events.length,
            error: `HTTP ${fetchResult.status} na consulta ao Transferegov`,
            httpStatus: fetchResult.status,
            authError: fetchResult.status === 401 || fetchResult.status === 403,
            durationMs: Date.now() - startedAt,
          };
        }

        const envelope = fetchResult.data;
        if (
          !envelope ||
          typeof envelope !== 'object' ||
          Array.isArray(envelope) ||
          !Array.isArray((envelope as Record<string, unknown>).data)
        ) {
          return {
            success: false,
            events,
            fetchedCount,
            normalizedCount: events.length,
            error: 'Resposta do Transferegov estruturalmente inválida: envelope esperado com campo data (array)',
            httpStatus: fetchResult.status,
            durationMs: Date.now() - startedAt,
          };
        }

        const envelopeRecord = envelope as Record<string, unknown>;
        const items = envelopeRecord.data as unknown[];

        if (page === FIRST_PAGE) {
          if (typeof envelopeRecord.total_pages !== 'number' || typeof envelopeRecord.total_items !== 'number') {
            return {
              success: false,
              events,
              fetchedCount,
              normalizedCount: events.length,
              error: 'Resposta do Transferegov estruturalmente inválida: total_pages e total_items obrigatórios',
              httpStatus: fetchResult.status,
              durationMs: Date.now() - startedAt,
            };
          }
          totalPages = envelopeRecord.total_pages;
          totalItems = envelopeRecord.total_items;
        }

        for (const item of items) {
          try {
            events.push(this.normalize(item));
          } catch (error) {
            logger.warn('Transferegov: falha ao normalizar item', {
              system: SYSTEM_CODE,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        fetchedCount += items.length;

        if (maxRecords && events.length >= maxRecords) break;
        if (items.length === 0) break;
        if (totalPages !== null && page >= totalPages) break;
        page++;
      }

      // Coerência de paginação: o total obtido deve bater com total_items,
      // exceto quando a sincronização foi limitada por maxRecords.
      if (totalItems !== null && !maxRecords && fetchedCount !== totalItems) {
        return {
          success: false,
          events,
          fetchedCount,
          normalizedCount: events.length,
          error: `Incoerência de paginação no Transferegov: total_items=${totalItems} mas registros obtidos=${fetchedCount}`,
          httpStatus: 200,
          durationMs: Date.now() - startedAt,
        };
      }

      return {
        success: true,
        events,
        fetchedCount,
        normalizedCount: events.length,
        message: `${fetchedCount} registros obtidos, ${events.length} normalizados`,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        success: false,
        events: [],
        fetchedCount: 0,
        normalizedCount: 0,
        error: error instanceof Error ? error.message : String(error),
        httpStatus: 0,
        authError: false,
        durationMs: Date.now() - startedAt,
      };
    }
  },
};

export default transferegovGovAdapter;

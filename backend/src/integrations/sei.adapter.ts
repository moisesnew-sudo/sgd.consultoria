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
 * Adapter de integração com o SEI — Sistema Eletrônico de Informações (Fase E1.1).
 *
 * O SEI é o sistema de gestão documental e tramitação eletrônica de processos
 * do Governo Federal. Utilizado para:
 * - Processos administrativos;
 * - Documentos oficiais;
 * - Tramitações e movimentações;
 * - Publicações no Diário Oficial.
 *
 * APIs disponíveis (conforme documentação pública):
 * - Consulta de processos por NUP (Número Único de Protocolo);
 * - Consulta de tramitações de processo;
 * - Consulta de documentos vinculados;
 * - Consulta de andamento/status.
 *
 * Autenticação: certificado digital A1/A3 ou token de API (quando disponível).
 */

const SYSTEM_CODE = 'sei';

/** Primeira página da API. */
const FIRST_PAGE = 1;
/** Máximo de registros por página aceito pela API. */
const MAX_PAGE_SIZE = 200;
/** Tamanho padrão de página usado na coleta paginada. */
const DEFAULT_PAGE_SIZE = 100;

const PROPOSAL_KEYS = ['proposal_number', 'numero_proposta', 'numeroProposta', 'proposta', 'id_proposta'];
const PROCESS_KEYS = ['numero_processo', 'process_number', 'processNumber', 'processo', 'nup'];
const STATUS_KEYS = ['status', 'situacao', 'tramite'];
const DEADLINE_KEYS = ['deadline', 'prazo', 'data_limite', 'dataLimite', 'data_finalizacao', 'dataFinalizacao'];
const EXTRA_DATE_KEYS = ['data_abertura', 'dataAbertura', 'data_criacao', 'dataCriacao'];

/**
 * Adapter síncrono puro — normalização de webhooks (compatível com Fase 2.2).
 */
export const seiAdapter: IntegrationAdapter = {
  system: SYSTEM_CODE,

  normalize(payload: unknown): NormalizedIntegrationEvent {
    const p = flattenPayload(payload);
    const processNumber = pickString(p, PROCESS_KEYS);
    const rawStatus = pickString(p, STATUS_KEYS);
    const extraDates: Record<string, unknown> = {};

    for (const key of EXTRA_DATE_KEYS) {
      const iso = toIsoDate(p[key]);
      if (iso) extraDates[key] = iso;
    }

    return {
      systemCode: this.system,
      eventType: extractEventType(p),
      proposalNumber: pickString(p, PROPOSAL_KEYS),
      externalId: processNumber,
      externalStatus: normalizeExternalStatus(rawStatus),
      deadline: toIsoDate(pickString(p, DEADLINE_KEYS)),
      extra: {
        ...(processNumber ? { processNumber } : {}),
        ...(Object.keys(extraDates).length > 0 ? { dates: extraDates } : {}),
        ...(rawStatus ? { rawStatus } : {}),
      },
    };
  },
};

/**
 * Adapter ativo de integração com o SEI (Fase E1.1).
 *
 * Implementa GovernmentIntegrationAdapter com:
 * - Autenticação via token de API;
 * - Consulta de processos por NUP;
 * - Consulta de tramitações;
 * - Validação de payloads com NUP;
 * - Sincronização pull de dados.
 */
export const seiGovAdapter: GovernmentIntegrationAdapter = {
  system: SYSTEM_CODE,

  normalize(payload: unknown): NormalizedIntegrationEvent {
    return seiAdapter.normalize(payload);
  },

  async authenticate(config: AdapterConfig): Promise<string | null> {
    const secretKey = config.secretEnvKey;
    if (!secretKey) {
      logger.info('SEI: sem secret_env_key configurado — modo sem autenticação', { system: SYSTEM_CODE });
      return null;
    }

    const secret = readSecret(secretKey);
    if (!secret) {
      logger.warn('SEI: secret não disponível — autenticação ignorada', { system: SYSTEM_CODE });
      return null;
    }

    const authType = (config.extra?.authType as string) ?? 'token';

    if (authType === 'oauth2') {
      const tokenUrl = `${config.baseUrl}/api/v1/auth/token`;
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
            logger.info('SEI: autenticação OAuth2 concluída', { system: SYSTEM_CODE });
            return token;
          }
        }

        logger.error('SEI: falha na autenticação OAuth2', {
          system: SYSTEM_CODE,
          status: response.status,
        });
        return null;
      } catch (error) {
        logger.error('SEI: erro na autenticação OAuth2', {
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

    // Modo de coleta paginada (motor de snapshot): pagina a partir de 1,
    // tamanho_da_pagina <= 200. Quando pagina é informado, a consulta usa o
    // envelope paginado { data, total_pages, total_items } do recurso de listagem.
    const parsedPage = Number(params.pagina);
    const pagina = Number.isFinite(parsedPage) && parsedPage >= FIRST_PAGE ? Math.floor(parsedPage) : undefined;
    const requestedSize = Number(params.tamanho_da_pagina ?? params.tamanhoDaPagina);
    const tamanhoDaPagina = Number.isFinite(requestedSize) && requestedSize > 0
      ? Math.min(Math.floor(requestedSize), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const processNumber = params.processNumber as string | undefined;
    const proposalNumber = params.proposalNumber as string | undefined;
    const status = params.status as string | undefined;
    const includeTramitacoes = params.includeTramitacoes as boolean | undefined;

    let endpoint: string;

    if (pagina !== undefined) {
      endpoint = `${baseUrl}/api/v1/processos?pagina=${pagina}&tamanho_da_pagina=${tamanhoDaPagina}`;
    } else if (processNumber) {
      endpoint = `${baseUrl}/api/v1/processos/${encodeURIComponent(processNumber)}`;
      if (includeTramitacoes) {
        endpoint += '/tramitacoes';
      }
    } else if (proposalNumber) {
      endpoint = `${baseUrl}/api/v1/processos?proposta=${encodeURIComponent(proposalNumber)}`;
    } else if (status) {
      endpoint = `${baseUrl}/api/v1/processos?situacao=${encodeURIComponent(status)}`;
    } else {
      endpoint = `${baseUrl}/api/v1/processos`;
    }

    const headers: Record<string, string> = {};
    if (credential) {
      const authType = (config.extra?.authType as string) ?? 'token';
      if (authType === 'oauth2') {
        headers['Authorization'] = `Bearer ${credential}`;
      } else {
        headers['X-Auth-Token'] = credential;
      }
    }

    return httpClient(config, { url: endpoint, method: 'GET', headers });
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
    const processNumber = pickString(p, PROCESS_KEYS);
    const proposalNumber = pickString(p, PROPOSAL_KEYS);

    if (!processNumber && !proposalNumber) {
      return 'Payload deve conter número de processo (NUP) ou número de proposta';
    }

    if (processNumber && !/^\d{5}\.\d{6}\/\d{4}-\d{2}$/.test(processNumber)) {
      return 'Formato de NUP inválido. Esperado: NNNNN.NNNNNN/AAAA-XX';
    }

    const status = pickString(p, STATUS_KEYS);
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

    try {
      const credential = await this.authenticate(config);

      const fetchResult = await this.fetch(config, credential, params);

      if (fetchResult.status === 0) {
        return {
          success: false,
          events: [],
          fetchedCount: 0,
          normalizedCount: 0,
          error: 'BaseUrl não configurada para o SEI',
          httpStatus: 0,
          durationMs: Date.now() - startedAt,
        };
      }

      if (fetchResult.status !== 200) {
        return {
          success: false,
          events: [],
          fetchedCount: 0,
          normalizedCount: 0,
          error: `HTTP ${fetchResult.status} na consulta ao SEI`,
          httpStatus: fetchResult.status,
          authError: fetchResult.status === 401 || fetchResult.status === 403,
          durationMs: Date.now() - startedAt,
        };
      }

      const rawData = fetchResult.data;
      const items: unknown[] = Array.isArray(rawData) ? rawData : rawData && typeof rawData === 'object' ? [rawData] : [];

      const events: NormalizedIntegrationEvent[] = [];
      let normalizedCount = 0;

      for (const item of items) {
        try {
          const normalized = this.normalize(item);
          events.push(normalized);
          normalizedCount++;
        } catch (error) {
          logger.warn('SEI: falha ao normalizar item', {
            system: SYSTEM_CODE,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        events,
        fetchedCount: items.length,
        normalizedCount,
        message: `${items.length} processos obtidos, ${normalizedCount} normalizados`,
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

export default seiGovAdapter;

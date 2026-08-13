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
      const authType = (config.extra?.authType as string) ?? 'api_key';
      if (authType === 'oauth2') {
        headers['Authorization'] = `Bearer ${credential}`;
      } else {
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

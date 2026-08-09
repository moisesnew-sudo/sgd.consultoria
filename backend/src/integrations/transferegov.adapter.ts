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
 * Adapter de integração com o Transferegov (Fase E1.1).
 *
 * O Transferegov é a plataforma do Governo Federal para gestão de transferências
 * voluntárias (convênios, contratos de repasse, propostas).
 *
 * APIs disponíveis (conforme documentação pública):
 * - Consulta de propostas por número;
 * - Consulta de convênios/contratos;
 * - Consulta de status de propostas;
 * - Eventos de alteração de status.
 *
 * Autenticação: OAuth2 client credentials (quando disponível) ou API key.
 *
 * IMPORTANTE: Este adapter prepara a estrutura para integração real.
 * As URLs e contratos de API serão validados quando a documentação oficial
 * do Transferegov estiver disponível para o município.
 */

const SYSTEM_CODE = 'transferegov';

const PROPOSAL_KEYS = ['proposal_number', 'numero_proposta', 'numeroProposta', 'proposta', 'id_proposta'];
const CONTRACT_KEYS = ['contract_number', 'numero_convenio', 'numeroConvenio', 'convenio', 'contrato'];
const STATUS_KEYS = ['status', 'situacao'];
const DEADLINE_KEYS = ['deadline', 'prazo', 'data_limite', 'dataLimite', 'data_vencimento', 'dataVencimento'];

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
 * Adapter ativo de integração com o Transferegov (Fase E1.1).
 *
 * Implementa GovernmentIntegrationAdapter com:
 * - Autenticação OAuth2 client_credentials (quando configurado);
 * - Consulta de propostas e convênios;
 * - Validação de payloads;
 * - Sincronização pull de dados.
 */
export const transferegovGovAdapter: GovernmentIntegrationAdapter = {
  system: SYSTEM_CODE,

  normalize(payload: unknown): NormalizedIntegrationEvent {
    return transferegovAdapter.normalize(payload);
  },

  async authenticate(config: AdapterConfig): Promise<string | null> {
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

    const authType = (config.extra?.authType as string) ?? 'api_key';

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

    const proposalNumber = params.proposalNumber as string | undefined;
    const contractNumber = params.contractNumber as string | undefined;
    const status = params.status as string | undefined;

    let endpoint = `${baseUrl}/api/propostas`;

    if (proposalNumber) {
      endpoint = `${baseUrl}/api/propostas/${encodeURIComponent(proposalNumber)}`;
    } else if (contractNumber) {
      endpoint = `${baseUrl}/api/convenios/${encodeURIComponent(contractNumber)}`;
    } else if (status) {
      endpoint = `${baseUrl}/api/propostas?situacao=${encodeURIComponent(status)}`;
    }

    const headers: Record<string, string> = {};
    if (credential) {
      const authType = (config.extra?.authType as string) ?? 'api_key';
      if (authType === 'oauth2') {
        headers['Authorization'] = `Bearer ${credential}`;
      } else {
        headers['X-API-Key'] = credential;
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
    const proposalNumber = pickString(p, PROPOSAL_KEYS);
    const contractNumber = pickString(p, CONTRACT_KEYS);
    const status = pickString(p, STATUS_KEYS);

    if (!proposalNumber && !contractNumber) {
      return 'Payload deve conter número de proposta ou convênio';
    }

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
          error: 'BaseUrl não configurada para o Transferegov',
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
          error: `HTTP ${fetchResult.status} na consulta ao Transferegov`,
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
          logger.warn('Transferegov: falha ao normalizar item', {
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
        message: `${items.length} registros obtidos, ${normalizedCount} normalizados`,
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

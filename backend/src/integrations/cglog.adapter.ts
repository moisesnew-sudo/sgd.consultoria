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
 * Adapter de integração com o CGLOG — Controladoria-Geral do Log de Acesso (Fase E1.1).
 *
 * O CGLOG é o sistema de gestão de logs de acesso e rastreamento de ações
 * em sistemas governamentais. Utilizado para:
 * - Registro de eventos de acesso;
 * - Rastreamento de protocolos;
 * - Logs de alterações em documentos;
 * - Conformidade e auditoria.
 *
 * APIs disponíveis (conforme documentação pública):
 * - Consulta de eventos por período/tipo;
 * - Consulta de protocolos;
 * - Consulta de alterações em registros;
 * - Status de processamento.
 *
 * Autenticação: token de API ou certificado digital.
 */

const SYSTEM_CODE = 'cglog';

const PROPOSAL_KEYS = ['proposal_number', 'numero_proposta', 'numeroProposta', 'proposta', 'id_proposta'];
const PROTOCOL_KEYS = ['protocolo', 'numero_protocolo', 'numeroProtocolo', 'protocol'];
const STATUS_KEYS = ['status', 'situacao'];
const DEADLINE_KEYS = ['deadline', 'prazo', 'data_limite', 'dataLimite'];

/**
 * Adapter síncrono puro — normalização de webhooks (compatível com Fase 2.2).
 */
export const cglogAdapter: IntegrationAdapter = {
  system: SYSTEM_CODE,

  normalize(payload: unknown): NormalizedIntegrationEvent {
    const p = flattenPayload(payload);
    const protocol = pickString(p, PROTOCOL_KEYS);
    const rawStatus = pickString(p, STATUS_KEYS);

    return {
      systemCode: this.system,
      eventType: extractEventType(p),
      proposalNumber: pickString(p, PROPOSAL_KEYS),
      externalId: protocol,
      externalStatus: normalizeExternalStatus(rawStatus),
      deadline: toIsoDate(pickString(p, DEADLINE_KEYS)),
      extra: {
        ...(protocol ? { protocol } : {}),
        ...(rawStatus ? { rawStatus } : {}),
      },
    };
  },
};

/**
 * Adapter ativo de integração com o CGLOG (Fase E1.1).
 *
 * Implementa GovernmentIntegrationAdapter com:
 * - Autenticação via token de API;
 * - Consulta de eventos por período;
 * - Consulta de protocolos;
 * - Validação de payloads;
 * - Sincronização pull de dados.
 */
export const cglogGovAdapter: GovernmentIntegrationAdapter = {
  system: SYSTEM_CODE,

  normalize(payload: unknown): NormalizedIntegrationEvent {
    return cglogAdapter.normalize(payload);
  },

  async authenticate(config: AdapterConfig): Promise<string | null> {
    const secretKey = config.secretEnvKey;
    if (!secretKey) {
      logger.info('CGLOG: sem secret_env_key configurado — modo sem autenticação', { system: SYSTEM_CODE });
      return null;
    }

    const secret = readSecret(secretKey);
    if (!secret) {
      logger.warn('CGLOG: secret não disponível — autenticação ignorada', { system: SYSTEM_CODE });
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
            logger.info('CGLOG: autenticação OAuth2 concluída', { system: SYSTEM_CODE });
            return token;
          }
        }

        logger.error('CGLOG: falha na autenticação OAuth2', {
          system: SYSTEM_CODE,
          status: response.status,
        });
        return null;
      } catch (error) {
        logger.error('CGLOG: erro na autenticação OAuth2', {
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

    const protocol = params.protocol as string | undefined;
    const proposalNumber = params.proposalNumber as string | undefined;
    const eventType = params.eventType as string | undefined;
    const dateFrom = params.dateFrom as string | undefined;
    const dateTo = params.dateTo as string | undefined;

    let endpoint: string;

    if (protocol) {
      endpoint = `${baseUrl}/api/v1/eventos?protocolo=${encodeURIComponent(protocol)}`;
    } else if (proposalNumber) {
      endpoint = `${baseUrl}/api/v1/eventos?proposta=${encodeURIComponent(proposalNumber)}`;
    } else {
      const queryParams: string[] = [];
      if (eventType) queryParams.push(`tipo=${encodeURIComponent(eventType)}`);
      if (dateFrom) queryParams.push(`data_inicio=${encodeURIComponent(dateFrom)}`);
      if (dateTo) queryParams.push(`data_fim=${encodeURIComponent(dateTo)}`);
      endpoint = `${baseUrl}/api/v1/eventos${queryParams.length > 0 ? '?' + queryParams.join('&') : ''}`;
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
    const protocol = pickString(p, PROTOCOL_KEYS);
    const proposalNumber = pickString(p, PROPOSAL_KEYS);

    if (!protocol && !proposalNumber) {
      return 'Payload deve conter número de protocolo ou número de proposta';
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
          error: 'BaseUrl não configurada para o CGLOG',
          httpStatus: 0,
          durationMs: Date.now() - startedAt,
        };
      }

      if (fetchResult.status !== 200) {
        const isAuthError = fetchResult.status === 401 || fetchResult.status === 403;
        return {
          success: false,
          events: [],
          fetchedCount: 0,
          normalizedCount: 0,
          error: `HTTP ${fetchResult.status} na consulta ao CGLOG`,
          httpStatus: fetchResult.status,
          authError: isAuthError,
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
          logger.warn('CGLOG: falha ao normalizar item', {
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
        message: `${items.length} eventos obtidos, ${normalizedCount} normalizados`,
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

export default cglogGovAdapter;

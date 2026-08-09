import { logger } from '../lib/logger.js';
import type { AdapterConfig, ExternalApiResponse } from './types.js';

/**
 * HTTP client base para integrações governamentais (Fase E1.1).
 *
 * Funcionalidades:
 * - Timeout configurável por requisição;
 * - Retry com backoff exponencial (429, 5xx, erros de rede);
 * - Headers padrão (Accept, User-Agent);
 * - Logging sanitizado (sem tokens/senhas);
 * - Registro de duração para métricas de saúde.
 *
 * SEGURANÇÃO:
 * - Nunca loga headers Authorization/Secret;
 * - Timeout prevém requests pendentes infinitos;
 * - Retry limitado para não sobrecarregar sistemas externos.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRY_BASE_DELAY_MS = 30_000;

/** Status HTTP elegíveis para retry automático. */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** Headers que NUNCA devem aparecer em logs. */
const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-auth-token',
]);

export interface HttpRequestConfig {
  /** URL completa da requisição. */
  url: string;
  /** Método HTTP (padrão: GET). */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Headers adicionais (mesclados com padrão). */
  headers?: Record<string, string>;
  /** Body da requisição (serializado automaticamente se for objeto). */
  body?: unknown;
  /** Timeout específico desta requisição (sobrepõe config.timeoutMs). */
  timeoutMs?: number;
  /** Número máximo de retries para esta requisição (sobrepõe config.maxRetries). */
  maxRetries?: number;
  /** Se true, não registra logs de request/response (para operações sensíveis). */
  silent?: boolean;
}

/**
 * Sanitiza headers para logging — redige valores de chaves sensíveis.
 */
function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_KEYS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Calcula o delay de backoff exponencial com jitter.
 */
function computeBackoffDelay(attempt: number, baseDelayMs: number): number {
  const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt), MAX_RETRY_BASE_DELAY_MS);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Executa uma requisição HTTP com timeout, retry e logging sanitizado.
 *
 * @param config Configuração base (baseUrl, timeout, retries) de AdapterConfig.
 * @param request Configuração da requisição específica.
 * @returns Resposta HTTP padronizada.
 */
export async function httpClient(
  config: AdapterConfig,
  request: HttpRequestConfig
): Promise<ExternalApiResponse> {
  const timeoutMs = request.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = request.maxRetries ?? config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  const defaultHeaders: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'SGD-Consultoria/2.0',
  };

  const allHeaders = { ...defaultHeaders, ...request.headers };

  let lastError: Error | null = null;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startedAt = Date.now();

    if (!request.silent) {
      logger.info('HTTP request iniciado', {
        method: request.method ?? 'GET',
        url: request.url,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        headers: sanitizeHeadersForLog(allHeaders),
      });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOptions: RequestInit = {
        method: request.method ?? 'GET',
        headers: allHeaders,
        signal: controller.signal,
      };

      if (request.body !== undefined && request.method !== 'GET') {
        fetchOptions.body = typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body);
        if (!allHeaders['Content-Type']) {
          (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
        }
      }

      const response = await fetch(request.url, fetchOptions);
      clearTimeout(timeoutId);

      const durationMs = Date.now() - startedAt;
      lastStatus = response.status;

      let data: unknown = null;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        try {
          data = await response.json();
        } catch {
          data = null;
        }
      } else {
        try {
          data = await response.text();
        } catch {
          data = null;
        }
      }

      if (!request.silent) {
        logger.info('HTTP response recebido', {
          url: request.url,
          status: response.status,
          durationMs,
          attempt: attempt + 1,
        });
      }

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxRetries) {
        const delayMs = computeBackoffDelay(attempt, retryBaseDelayMs);
        if (!request.silent) {
          logger.warn('HTTP response elegível para retry', {
            url: request.url,
            status: response.status,
            attempt: attempt + 1,
            nextRetryInMs: delayMs,
          });
        }
        await sleep(delayMs);
        continue;
      }

      return { status: response.status, data, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!request.silent) {
        logger.error('HTTP request falhou', {
          url: request.url,
          attempt: attempt + 1,
          durationMs,
          error: lastError.message,
        });
      }

      if (attempt < maxRetries) {
        const delayMs = computeBackoffDelay(attempt, retryBaseDelayMs);
        if (!request.silent) {
          logger.warn('Retry agendado após falha de rede', {
            url: request.url,
            attempt: attempt + 1,
            nextRetryInMs: delayMs,
          });
        }
        await sleep(delayMs);
        continue;
      }
    }
  }

  const finalDurationMs = 0;
  return {
    status: lastStatus || 0,
    data: null,
    durationMs: finalDurationMs,
  };
}

/**
 * Lê uma variável de ambiente de forma segura.
 * Lança erro se a variável não estiver definida (fail-fast).
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória não configurada: ${key}`);
  }
  return value;
}

/**
 * Lê uma variável de ambiente opcional com valor padrão.
 */
export function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * Lê segredo de uma variável de ambiente configurada em secret_env_key.
 * Retorna null se a variável não estiver configurada (modo degradado).
 */
export function readSecret(secretEnvKey: string): string | null {
  const value = process.env[secretEnvKey];
  if (!value) {
    logger.warn('Secret não configurado via variável de ambiente', { secretEnvKey });
    return null;
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

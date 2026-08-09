/**
 * Fase D3.1 — Webhook Dispatcher (saída).
 *
 * Subscreve ao Event Bus e entrega eventos a endpoints externos configurados.
 * Operação 100% assíncrona: NÃO bloqueia o Event Bus, SSE, nem operações do usuário.
 *
 * Segurança:
 * - Payload assinado com HMAC-SHA256 (header X-SGD-Signature);
 * - Segredo armazenado como hash SHA-256 (nunca em texto plano no banco);
 * - Validação de URL (anti-SSRF: bloqueia localhost, private IPs);
 * - Payload sanitizado (nunca envia tokens, passwords, cookies).
 *
 * Retry:
 * - 3 tentativas com backoff exponencial (1s, 5s, 30s);
 * - Cada tentativa registrada em webhook_deliveries.
 */

import crypto from 'crypto';
import { all, run, get } from '../database.js';
import { logger } from './logger.js';
import {
  onIntegrationEvent,
  offIntegrationEvent,
  type IntegrationEventName,
  type IntegrationEventPayloads,
} from './eventBus.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface OutboundWebhook {
  id: number;
  name: string;
  url: string;
  secret_hash: string;
  events: string[];
  active: boolean;
  tenant_id: number;
}

export interface WebhookDelivery {
  id: number;
  webhook_id: number;
  event_type: string;
  url: string;
  request_headers: Record<string, string> | null;
  request_body: unknown;
  response_status: number | null;
  response_body: string | null;
  duration_ms: number | null;
  attempt: number;
  max_attempts: number;
  status: 'pending' | 'sending' | 'success' | 'failed' | 'retrying' | 'dead_letter';
  error: string | null;
  delivery_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface ExternalPayload {
  id: string;
  type: string;
  timestamp: string;
  data: unknown;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 10_000;
const BACKOFF_DELAYS_MS = [1_000, 5_000, 30_000];

/** URLs internas bloqueadas (anti-SSRF). */
const BLOCKED_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '::1', '0.0.0.0',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal', // GCP metadata
]);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Gera hash SHA-256 de um segredo (para armazenamento no banco).
 */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Verifica se um segredo corresponde ao hash armazenado.
 */
export function verifySecret(secret: string, hash: string): boolean {
  const computed = hashSecret(secret);
  // timingSafeEqual para prevenir timing attacks
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Gera assinatura HMAC-SHA256 para o payload.
 * Formato: sha256=<hex>
 */
export function signPayload(secret: string, body: string): string {
  const signature = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${signature}`;
}

/**
 * Valida se uma URL é segura (anti-SSRF).
 * Retorna true se a URL pode ser usada.
 */
export function isValidWebhookUrl(urlStr: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlStr);

    // Apenas HTTPS em produção
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { valid: false, error: 'Protocolo inválido (use https:)' };
    }

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return { valid: false, error: 'URL aponta para endereço interno (SSRF bloqueado)' };
    }

    // Bloqueia ranges privados
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(hostname)) {
      return { valid: false, error: 'URL aponta para rede privada' };
    }

    if (hostname.length === 0) {
      return { valid: false, error: 'URL sem hostname' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'URL inválida' };
  }
}

/**
 * Sanitiza um payload para envio externo.
 * Remove campos sensíveis e garante formato estável.
 */
export function sanitizePayload(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitizePayload);

  const sensitive = /(password|secret|token|cookie|api_key|private_key|authorization|credential|hash)/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (sensitive.test(k)) continue;
    if (v && typeof v === 'object') {
      out[k] = sanitizePayload(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Delivery (HTTP)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Registra uma tentativa de entrega no banco.
 */
async function recordDelivery(
  webhookId: number,
  eventType: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  attempt: number,
  maxAttempts: number,
  status: 'pending' | 'sending' | 'success' | 'failed' | 'retrying' | 'dead_letter',
  deliveryId: string,
  responseStatus?: number,
  responseBody?: string,
  durationMs?: number,
  error?: string,
): Promise<number> {
  const resolvedAt = (status === 'success' || status === 'dead_letter') ? 'NOW()' : 'NULL';
  const result = await run(
    `INSERT INTO webhook_deliveries
       (webhook_id, event_type, url, request_headers, request_body, response_status, response_body, duration_ms, attempt, max_attempts, status, error, delivery_id)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      webhookId, eventType, url,
      JSON.stringify(headers),
      JSON.stringify(body),
      responseStatus ?? null,
      responseBody?.slice(0, 10000) ?? null,
      durationMs ?? null,
      attempt, maxAttempts, status, error ?? null, deliveryId,
    ]
  );
  return result.rows[0].id as number;
}

/**
 * Envia um webhook para um endpoint externo.
 * Retorna { ok, status, body, durationMs, error? }.
 */
async function deliverOnce(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ ok: boolean; status: number; body: string; durationMs: number; error?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const resBody = await res.text();
    const durationMs = Date.now() - start;

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      body: resBody.slice(0, 10000),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: '', durationMs, error: msg };
  }
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

/**
 * Processa um evento: encontra webhooks inscritos e entrega assincronamente.
 * Chamado pelo listener do Event Bus. Não bloqueia o emissor.
 */
async function handleEvent<K extends IntegrationEventName>(
  eventType: K,
  payload: IntegrationEventPayloads[K],
): Promise<void> {
  try {
    const webhooks = await all<OutboundWebhook>(
      `SELECT id, name, url, secret_hash, events, active
       FROM outbound_webhooks
       WHERE active = TRUE AND $1 = ANY(events)`,
      [eventType]
    );

    if (webhooks.length === 0) return;

    const externalPayload: ExternalPayload = {
      id: crypto.randomUUID(),
      type: eventType,
      timestamp: new Date().toISOString(),
      data: sanitizePayload(payload),
    };

    for (const webhook of webhooks) {
      // Delivery assíncrona (fire-and-forget com retry)
      deliverWithRetry(webhook, eventType, externalPayload).catch((err) => {
        logger.error('webhookDispatcher: unexpected delivery error', {
          webhookId: webhook.id,
          event: eventType,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } catch (err) {
    logger.error('webhookDispatcher: handleEvent error', {
      event: eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Entrega um evento com retry exponencial.
 * Cada tentativa é registrada como uma row separada em webhook_deliveries.
 * Após esgotar tentativas, status = 'dead_letter'.
 */
async function deliverWithRetry(
  webhook: OutboundWebhook,
  eventType: string,
  payload: ExternalPayload,
): Promise<void> {
  const body = JSON.stringify(payload);
  const deliveryId = payload.id;
  const maxAttempts = MAX_ATTEMPTS;

  const secretEnvKey = `OUTBOUND_WEBHOOK_SECRET_${webhook.id}`;
  const secret = process.env[secretEnvKey];
  if (!secret || secret.length < 16) {
    logger.warn('webhookDispatcher: secret not configured', { webhookId: webhook.id, envKey: secretEnvKey });
    await recordDelivery(webhook.id, eventType, webhook.url, {}, payload, 1, maxAttempts, 'dead_letter', deliveryId, undefined, undefined, undefined, `Secret ${secretEnvKey} não configurado`);
    return;
  }

  const signature = signPayload(secret, body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-SGD-Signature': signature,
    'X-SGD-Event': eventType,
    'X-SGD-Delivery': deliveryId,
    'User-Agent': 'SGD-Webhook/2.0',
  };

  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let lastBody: string | undefined;
  let lastDurationMs: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Backoff antes de tentativas após a primeira
    if (attempt > 1) {
      const delay = BACKOFF_DELAYS_MS[attempt - 2] ?? 30_000;
      await new Promise((r) => setTimeout(r, delay));
    }

    const result = await deliverOnce(webhook.url, headers, body);
    lastError = result.error;
    lastStatus = result.status;
    lastBody = result.body;
    lastDurationMs = result.durationMs;

    if (result.ok) {
      await recordDelivery(webhook.id, eventType, webhook.url, headers, body, attempt, maxAttempts, 'success', deliveryId, result.status, result.body, result.durationMs);
      logger.info('webhookDispatcher: delivered', {
        webhookId: webhook.id,
        event: eventType,
        attempt,
        status: result.status,
        durationMs: result.durationMs,
      });
      return;
    }

    // Falhou — registra esta tentativa
    const isLastAttempt = attempt === maxAttempts;
    const attemptStatus = isLastAttempt ? 'dead_letter' : 'retrying';
    await recordDelivery(webhook.id, eventType, webhook.url, headers, body, attempt, maxAttempts, attemptStatus, deliveryId, lastStatus, lastBody, lastDurationMs, lastError);
  }

  // Todas as tentativas falharam (dead_letter já registrado na última iteração)
  logger.error('webhookDispatcher: delivery dead-lettered', {
    webhookId: webhook.id,
    event: eventType,
    attempts: maxAttempts,
    lastStatus,
    lastError,
  });
}

/* ------------------------------------------------------------------ */
/* Manual Retry                                                        */
/* ------------------------------------------------------------------ */

/**
 * Reenvia uma entrega que falhou (failed ou dead_letter).
 * Cria uma NOVA row na tabela (não reutiliza a original).
 * Retorna a nova delivery row ou null se inválido.
 */
export async function retryDelivery(deliveryId: number): Promise<WebhookDelivery | null> {
  const original = await get<WebhookDelivery>(
    `SELECT * FROM webhook_deliveries WHERE id = $1`,
    [deliveryId]
  );
  if (!original) return null;
  if (original.status !== 'failed' && original.status !== 'dead_letter') return null;

  const webhook = await get<OutboundWebhook>(
    `SELECT id, name, url, secret_hash, events, active FROM outbound_webhooks WHERE id = $1`,
    [original.webhook_id]
  );
  if (!webhook || !webhook.active) return null;

  // Parse do body original para reenvio
  const payload: ExternalPayload = typeof original.request_body === 'string'
    ? JSON.parse(original.request_body)
    : (original.request_body as ExternalPayload) ?? {
        id: crypto.randomUUID(),
        type: original.event_type,
        timestamp: new Date().toISOString(),
        data: {},
      };

  // Enviar com retry completo
  await deliverWithRetry(webhook, original.event_type, payload);

  // Retornar a entrega mais recente para este delivery_id
  const latest = await get<WebhookDelivery>(
    `SELECT * FROM webhook_deliveries WHERE delivery_id = $1 ORDER BY attempt DESC LIMIT 1`,
    [original.delivery_id ?? String(deliveryId)]
  );
  return latest ?? null;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

const subscribedIds: string[] = [];

/**
 * Inicia o webhook dispatcher: subscreve aos eventos do Event Bus.
 * Chamado por server.ts na inicialização.
 */
export function startWebhookDispatcher(): void {
  const eventsToListen: IntegrationEventName[] = [
    'demand:created', 'demand:updated', 'demand:status_changed', 'demand:deleted',
    'comment:created',
  ];

  for (const event of eventsToListen) {
    const id = onIntegrationEvent(event, (payload) => {
      void handleEvent(event, payload);
    });
    subscribedIds.push(id);
  }

  logger.info('webhookDispatcher started', { events: eventsToListen });
}

/**
 * Para o webhook dispatcher: remove todos os listeners.
 */
export function stopWebhookDispatcher(): void {
  for (const id of subscribedIds) {
    offIntegrationEvent(id);
  }
  subscribedIds.length = 0;
  logger.info('webhookDispatcher stopped');
}

export default {
  startWebhookDispatcher,
  stopWebhookDispatcher,
  hashSecret,
  verifySecret,
  signPayload,
  isValidWebhookUrl,
  sanitizePayload,
  handleEvent,
  retryDelivery,
};

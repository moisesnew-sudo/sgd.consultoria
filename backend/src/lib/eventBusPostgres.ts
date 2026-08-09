/**
 * Fase D1.7 — PostgreSQL LISTEN/NOTIFY para SSE multi-instância.
 *
 * Camada de sincronização entre instâncias do backend via PostgreSQL.
 * Cada instância mantém uma conexão dedicada para LISTEN no canal sgd_events.
 * Quando uma notificação chega, o evento é reemitido no eventBus local
 * (apenas se NÃO foi originado nesta instância — evita duplicação).
 *
 * F2.1 — Recuperação de eventos:
 * - Buffer temporário (janela deslizante) dos últimos eventos publicados;
 * - Registro da última notificação recebida (lastNotificationAt);
 * - Métrica de eventos perdidos (falhas de NOTIFY + lacunas de reconexão);
 * - Fila de NOTIFYs pendentes reenviada na reconexão (evita perda silenciosa);
 * - Log de reconexão com motivo.
 *
 * Canal: sgd_events
 * Payload: { event, payload, originId, timestamp }
 */

import pg from 'pg';
import { logger } from './logger.js';
import { emitIntegrationEvent, getEventNames, registerPostgresNotify } from './eventBus.js';
import type { IntegrationEventName } from './eventBus.js';
import {
  setListenerConnected,
  setListenerOriginId,
  recordListenerNotification,
  incrementListenerReconnect,
  incrementListenerLostEvents,
  recordListenerReconnectReason,
  incrementEventBusErrors,
} from './healthStatus.js';

const CHANNEL = 'sgd_events';
const MAX_PAYLOAD_BYTES = 64 * 1024;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Tamanho máximo do buffer temporário de eventos publicados. */
const MAX_BUFFERED_EVENTS = 100;
/** Tamanho máximo da fila de NOTIFYs pendentes durante indisponibilidade. */
const MAX_PENDING_NOTIFICATIONS = 500;

/** Evento publicado por esta instância, mantido no buffer de diagnóstico. */
export interface BufferedEvent {
  seq: number;
  event: string;
  payload: unknown;
  timestamp: string;
}

interface PendingNotification {
  event: string;
  payload: unknown;
}

let listenerClient: pg.PoolClient | null = null;
let listenerPool: pg.Pool | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
let originId = '';

let seqCounter = 0;
const eventBuffer: BufferedEvent[] = [];
const pendingNotifications: PendingNotification[] = [];
let lastNotificationAt: string | null = null;
let lostEventCount = 0;
let disconnectedAt: number | null = null;
let lastReconnectReason: string | null = null;

export function getOriginId(): string {
  return originId;
}

export function setOriginId(id: string): void {
  originId = id;
}

/** Retorna cópia do buffer temporário de eventos publicados. */
export function getBufferedEvents(): ReadonlyArray<BufferedEvent> {
  return eventBuffer.slice();
}

/** Retorna a quantidade de eventos na fila de NOTIFYs pendentes. */
export function getPendingNotificationCount(): number {
  return pendingNotifications.length;
}

/** Retorna timestamp (ISO) da última notificação recebida, ou null. */
export function getLastNotificationAt(): string | null {
  return lastNotificationAt;
}

/** Retorna contagem de eventos potencialmente perdidos. */
export function getLostEventCount(): number {
  return lostEventCount;
}

/** Retorna o motivo da última reconexão, ou null. */
export function getLastReconnectReason(): string | null {
  return lastReconnectReason;
}

function getSSLConfig(): unknown {
  if (process.env.NODE_ENV !== 'production') return false;
  if (process.env.DB_CA_CERT) return { ca: process.env.DB_CA_CERT };
  return { rejectUnauthorized: false };
}

function createListenerPool(): pg.Pool {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: getSSLConfig() as pg.PoolConfig['ssl'],
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 10_000,
  });
}

function bufferEvent(event: string, payload: unknown): void {
  seqCounter++;
  eventBuffer.push({ seq: seqCounter, event, payload, timestamp: new Date().toISOString() });
  if (eventBuffer.length > MAX_BUFFERED_EVENTS) {
    eventBuffer.splice(0, eventBuffer.length - MAX_BUFFERED_EVENTS);
  }
}

function handleNotification(msg: pg.Notification) {
  if (!msg.payload) return;

  if (msg.payload.length > MAX_PAYLOAD_BYTES) {
    logger.warn('eventBusPostgres: payload too large, ignoring', { size: msg.payload.length });
    return;
  }

  try {
    const parsed = JSON.parse(msg.payload);
    const { event, payload, originId: eventOrigin } = parsed;

    if (!event || typeof event !== 'string') {
      logger.warn('eventBusPostgres: invalid event name', { event });
      return;
    }

    if (!getEventNames().includes(event as IntegrationEventName)) {
      logger.debug('eventBusPostgres: unknown event, ignoring', { event });
      return;
    }

    if (eventOrigin && eventOrigin === originId) {
      return;
    }

    lastNotificationAt = new Date().toISOString();
    recordListenerNotification();
    emitIntegrationEvent(event as IntegrationEventName, payload);
  } catch (err) {
    logger.error('eventBusPostgres: failed to parse notification', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function markDisconnected(reason: string): void {
  if (disconnectedAt === null) {
    disconnectedAt = Date.now();
  }
  lastReconnectReason = reason;
  recordListenerReconnectReason(reason);
}

function scheduleReconnect(attempt: number, reason: string): void {
  if (shuttingDown) return;
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
  lastReconnectReason = reason;
  recordListenerReconnectReason(reason);
  logger.info('eventBusPostgres: reconnecting', { delayMs: delay, attempt, reason });
  reconnectTimer = setTimeout(() => {
    connectAndListen(attempt + 1);
  }, delay);
}

/** Reenvia NOTIFYs que falharam durante a indisponibilidade. */
async function flushPendingNotifications(): Promise<void> {
  if (pendingNotifications.length === 0) return;
  const pending = pendingNotifications.splice(0, pendingNotifications.length);
  let flushed = 0;
  for (const { event, payload } of pending) {
    try {
      await notifyPostgres(event, payload);
      flushed++;
    } catch {
      lostEventCount++;
      incrementListenerLostEvents();
    }
  }
  logger.info('eventBusPostgres: NOTIFYs pendentes reenviados', { total: pending.length, flushed });
}

async function connectAndListen(attempt = 0): Promise<void> {
  if (shuttingDown) return;

  try {
    if (!listenerPool) {
      listenerPool = createListenerPool();
    }

    listenerClient = await listenerPool.connect();
    await listenerClient.query(`LISTEN ${CHANNEL}`);

    listenerClient.on('notification', handleNotification);

    listenerClient.on('error', (err) => {
      logger.error('eventBusPostgres: listener connection error', {
        error: err.message,
      });
      markDisconnected('connection_error');
      setListenerConnected(false);
      incrementListenerReconnect();
      cleanupClient();
      if (!shuttingDown) scheduleReconnect(attempt + 1, 'connection_error');
    });

    listenerClient.on('end', () => {
      logger.warn('eventBusPostgres: listener connection ended');
      markDisconnected('connection_ended');
      setListenerConnected(false);
      incrementListenerReconnect();
      cleanupClient();
      if (!shuttingDown) scheduleReconnect(attempt + 1, 'connection_ended');
    });

    // F2.1 — Registra lacuna de reconexão (potenciais eventos não recebidos)
    // e reenvia NOTIFYs pendentes. Falha temporária não é perda silenciosa.
    if (disconnectedAt !== null) {
      const gapMs = Date.now() - disconnectedAt;
      const bufferedDuringGap = eventBuffer.filter(
        (e) => new Date(e.timestamp).getTime() >= (disconnectedAt as number)
      ).length;

      if (gapMs > 0) {
        lostEventCount++;
        incrementListenerLostEvents();
      }

      logger.warn('eventBusPostgres: reconectado após lacuna', {
        gapMs,
        bufferedEventsDuringGap: bufferedDuringGap,
        lostEvents: lostEventCount,
      });
      disconnectedAt = null;
    }

    await flushPendingNotifications();

    logger.info('eventBusPostgres: connected and listening', { channel: CHANNEL });
    setListenerConnected(true);
  } catch (err) {
    logger.error('eventBusPostgres: failed to connect', {
      error: err instanceof Error ? err.message : String(err),
      attempt,
    });
    markDisconnected('connect_failed');
    setListenerConnected(false);
    incrementListenerReconnect();
    cleanupClient();
    if (!shuttingDown) scheduleReconnect(attempt + 1, 'connect_failed');
  }
}

function cleanupClient(): void {
  if (listenerClient) {
    listenerClient.removeAllListeners();
    try { listenerClient.release(); } catch { /* ignore */ }
    listenerClient = null;
  }
}

/**
 * Publica um evento via PostgreSQL NOTIFY.
 * Chamado por publishEvent() no eventBus.
 *
 * F2.1 — Em caso de falha (banco indisponível), o evento é enfileirado como
 * pendente e reenviado na próxima reconexão; a perda é contabilizada.
 */
export async function notifyPostgres(
  event: string,
  payload: unknown,
): Promise<void> {
  bufferEvent(event, payload);

  if (!listenerPool) return;

  try {
    const client = await listenerPool.connect();
    try {
      const notification = JSON.stringify({
        event,
        payload,
        originId,
        timestamp: new Date().toISOString(),
      });
      await client.query(`SELECT pg_notify($1, $2)`, [CHANNEL, notification]);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('eventBusPostgres: notify failed', {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
    lostEventCount++;
    incrementListenerLostEvents();

    // Enfileira para reenvio na reconexão; descarta o mais antigo se exceder o limite.
    pendingNotifications.push({ event, payload });
    if (pendingNotifications.length > MAX_PENDING_NOTIFICATIONS) {
      pendingNotifications.splice(0, pendingNotifications.length - MAX_PENDING_NOTIFICATIONS);
    }
  }
}

/**
 * Inicia o listener PostgreSQL LISTEN.
 * Chamado no startup do servidor.
 */
export async function startPostgresListener(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.warn('eventBusPostgres: DATABASE_URL not set, skipping LISTEN');
    return;
  }

  if (!originId) {
    originId = `inst-${process.pid}-${Date.now()}`;
  }

  disconnectedAt = null;
  lastReconnectReason = null;
  recordListenerReconnectReason(null);

  setListenerOriginId(originId);
  registerPostgresNotify(notifyPostgres);
  shuttingDown = false;
  await connectAndListen(0);
}

/**
 * Para o listener PostgreSQL e limpa recursos.
 * Chamado no graceful shutdown.
 */
export async function stopPostgresListener(): Promise<void> {
  shuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  cleanupClient();

  if (listenerPool) {
    try {
      await listenerPool.end();
    } catch { /* ignore */ }
    listenerPool = null;
  }

  logger.info('eventBusPostgres: stopped');
  setListenerConnected(false);
}

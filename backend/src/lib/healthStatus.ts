/**
 * Fase D2.1 — Health Status centralizado.
 *
 * Store singleton que agrega estado de saúde de todos os componentes
 * críticos do backend: PostgreSQL pool, Event Bus, LISTEN/NOTIFY,
 * SSE e Alert Scheduler.
 *
 * Segurança: NÃO expõe connection strings, passwords, tokens, JWT,
 * cookies ou dados pessoais. Apenas contadores e timestamps.
 */

import { pool } from '../database.js';
import { logger } from './logger.js';
import { getCacheMetrics } from './cache.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ComponentStatus = 'ok' | 'degraded' | 'down';

export interface DatabaseStatus {
  status: ComponentStatus;
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  /** Saturação do pool (0..1): totalConnections / capacidade máxima. */
  poolSaturation: number;
  /** Consultas que excederam o limiar de lentidão (SLOW_QUERY_THRESHOLD_MS). */
  slowQueries: number;
}

export interface ListenerStatus {
  status: ComponentStatus;
  connected: boolean;
  originId: string;
  lastNotificationAt: string | null;
  reconnectCount: number;
  /** Eventos potencialmente perdidos: falhas de NOTIFY + lacunas de reconexão. */
  lostEvents: number;
  lastReconnectReason: string | null;
}

export interface EventBusStatus {
  status: ComponentStatus;
  eventsPublished: number;
  eventsReceived: number;
  errors: number;
  lastEventAt: string | null;
  activeListeners: number;
}

export interface SSEStatus {
  status: ComponentStatus;
  activeConnections: number;
  totalConnectionsOpened: number;
  totalConnectionsClosed: number;
  /** Conexões recusadas por atingir o limite máximo (anti-exaustão). */
  totalConnectionsRefused: number;
  /** Limite máximo de conexões SSE simultâneas configurado. */
  maxConnections: number;
  eventsSent: number;
  errors: number;
  lastConnectAt: string | null;
  lastDisconnectAt: string | null;
  lastRefusedAt: string | null;
}

export interface SchedulerStatus {
  status: ComponentStatus;
  active: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastAlertsProcessed: number | null;
  lastError: string | null;
}

export interface APIStatus {
  status: ComponentStatus;
  totalRequests: number;
  errors4xx: number;
  errors5xx: number;
  averageResponseTime: number;
  /** Requisições que excederam SLOW_REQUEST_THRESHOLD_MS. */
  slowRequests: number;
  lastRequestAt: string | null;
}

export interface CacheStatus {
  status: ComponentStatus;
  hits: number;
  misses: number;
  keys: number;
  evictions: number;
  hitRate: number;
}

export interface RateLimitStatus {
  status: ComponentStatus;
  blockedRequests: number;
  lastBlockedAt: string | null;
}

export interface JobQueueStatus {
  status: ComponentStatus;
  /** Jobs aguardando execução (pending + retrying). */
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  retrying: number;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastError: string | null;
}

export interface HealthReport {
  status: ComponentStatus;
  timestamp: string;
  uptime: number;
  version: string;
  database: DatabaseStatus;
  postgresListener: ListenerStatus;
  eventBus: EventBusStatus;
  sse: SSEStatus;
  scheduler: SchedulerStatus;
  api: APIStatus;
  cache: CacheStatus;
  rateLimit: RateLimitStatus;
  jobQueue: JobQueueStatus;
}

/* ------------------------------------------------------------------ */
/* Singleton                                                           */
/* ------------------------------------------------------------------ */

const state = {
  database: { lastError: null as string | null, lastCheckAt: null as string | null, slowQueries: 0 },
  listener: {
    connected: false,
    originId: '',
    lastNotificationAt: null as string | null,
    reconnectCount: 0,
    lostEvents: 0,
    lastReconnectReason: null as string | null,
  },
  eventBus: {
    eventsPublished: 0,
    eventsReceived: 0,
    errors: 0,
    lastEventAt: null as string | null,
    activeListeners: 0,
  },
  sse: {
    activeConnections: 0,
    totalConnectionsOpened: 0,
    totalConnectionsClosed: 0,
    totalConnectionsRefused: 0,
    maxConnections: 100,
    eventsSent: 0,
    errors: 0,
    lastConnectAt: null as string | null,
    lastDisconnectAt: null as string | null,
    lastRefusedAt: null as string | null,
  },
  scheduler: {
    active: false,
    lastRunAt: null as string | null,
    lastDurationMs: null as number | null,
    lastAlertsProcessed: null as number | null,
    lastError: null as string | null,
  },
  api: {
    totalRequests: 0,
    errors4xx: 0,
    errors5xx: 0,
    totalResponseTime: 0,
    slowRequests: 0,
    lastRequestAt: null as string | null,
  },
  rateLimit: {
    blockedRequests: 0,
    lastBlockedAt: null as string | null,
  },
  jobQueue: {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    lastRunAt: null as string | null,
    lastRunDurationMs: null as number | null,
    lastError: null as string | null,
  },
};

const startedAt = Date.now();

/** Limiar (ms) para marcar uma consulta como lenta. Configurável por ENV. */
const SLOW_QUERY_THRESHOLD_MS = (() => {
  const n = Number(process.env.SLOW_QUERY_THRESHOLD_MS ?? '200');
  return Number.isFinite(n) && n > 0 ? n : 200;
})();

/** Limiar (ms) para marcar uma requisição API como lenta. */
const SLOW_REQUEST_THRESHOLD_MS = (() => {
  const n = Number(process.env.SLOW_REQUEST_THRESHOLD_MS ?? '500');
  return Number.isFinite(n) && n > 0 ? n : 500;
})();

/* ------------------------------------------------------------------ */
/* Database metrics                                                    */
/* ------------------------------------------------------------------ */

export function getDatabaseStatus(): DatabaseStatus {
  const totalConnections = (pool as any).totalCount ?? 0;
  const idleConnections = (pool as any).idleCount ?? 0;
  const waitingClients = (pool as any).waitingCount ?? 0;
  const maxConnections = (pool as any).options?.max ?? 10;

  let status: ComponentStatus = 'ok';
  if (totalConnections === 0 && state.database.lastError) {
    status = 'down';
  } else if (waitingClients > 5) {
    status = 'degraded';
  } else if (maxConnections > 0 && totalConnections / maxConnections > 0.9) {
    status = 'degraded';
  }

  return {
    status,
    totalConnections,
    idleConnections,
    waitingClients,
    poolSaturation: maxConnections > 0 ? Math.min(1, totalConnections / maxConnections) : 0,
    slowQueries: state.database.slowQueries,
  };
}

export function recordDatabaseError(error: string): void {
  state.database.lastError = error;
}

export function clearDatabaseError(): void {
  state.database.lastError = null;
}

/** Registra a duração de uma query; contabiliza lentidão acima do limiar. */
export function recordQueryDuration(durationMs: number): void {
  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    state.database.slowQueries++;
  }
}

/* ------------------------------------------------------------------ */
/* PostgreSQL Listener metrics                                         */
/* ------------------------------------------------------------------ */

export function getListenerStatus(): ListenerStatus {
  let status: ComponentStatus = 'ok';
  if (!state.listener.connected) {
    status = 'down';
  }

  return {
    status,
    connected: state.listener.connected,
    originId: state.listener.originId,
    lastNotificationAt: state.listener.lastNotificationAt,
    reconnectCount: state.listener.reconnectCount,
    lostEvents: state.listener.lostEvents,
    lastReconnectReason: state.listener.lastReconnectReason,
  };
}

export function setListenerConnected(connected: boolean): void {
  state.listener.connected = connected;
}

export function setListenerOriginId(id: string): void {
  state.listener.originId = id;
}

export function recordListenerNotification(): void {
  state.listener.lastNotificationAt = new Date().toISOString();
}

export function incrementListenerReconnect(): void {
  state.listener.reconnectCount++;
}

export function incrementListenerLostEvents(count = 1): void {
  state.listener.lostEvents += count;
}

export function recordListenerReconnectReason(reason: string | null): void {
  state.listener.lastReconnectReason = reason;
}

/* ------------------------------------------------------------------ */
/* Event Bus metrics                                                   */
/* ------------------------------------------------------------------ */

export function getEventBusStatus(): EventBusStatus {
  let status: ComponentStatus = 'ok';
  if (state.eventBus.errors > 100) {
    status = 'degraded';
  }

  return {
    status,
    eventsPublished: state.eventBus.eventsPublished,
    eventsReceived: state.eventBus.eventsReceived,
    errors: state.eventBus.errors,
    lastEventAt: state.eventBus.lastEventAt,
    activeListeners: state.eventBus.activeListeners,
  };
}

export function incrementEventsPublished(): void {
  state.eventBus.eventsPublished++;
  state.eventBus.lastEventAt = new Date().toISOString();
}

export function incrementEventsReceived(): void {
  state.eventBus.eventsReceived++;
  state.eventBus.lastEventAt = new Date().toISOString();
}

export function incrementEventBusErrors(): void {
  state.eventBus.errors++;
}

export function setActiveListenerCount(count: number): void {
  state.eventBus.activeListeners = count;
}

/* ------------------------------------------------------------------ */
/* SSE metrics                                                         */
/* ------------------------------------------------------------------ */

export function getSSEStatus(): SSEStatus {
  let status: ComponentStatus = 'ok';
  if (state.sse.errors > 50) {
    status = 'degraded';
  }

  return {
    status,
    activeConnections: state.sse.activeConnections,
    totalConnectionsOpened: state.sse.totalConnectionsOpened,
    totalConnectionsClosed: state.sse.totalConnectionsClosed,
    totalConnectionsRefused: state.sse.totalConnectionsRefused,
    maxConnections: state.sse.maxConnections,
    eventsSent: state.sse.eventsSent,
    errors: state.sse.errors,
    lastConnectAt: state.sse.lastConnectAt,
    lastDisconnectAt: state.sse.lastDisconnectAt,
    lastRefusedAt: state.sse.lastRefusedAt,
  };
}

export function recordSSEConnect(): void {
  state.sse.activeConnections++;
  state.sse.totalConnectionsOpened++;
  state.sse.lastConnectAt = new Date().toISOString();
}

export function recordSSEDisconnect(): void {
  state.sse.activeConnections = Math.max(0, state.sse.activeConnections - 1);
  state.sse.totalConnectionsClosed++;
  state.sse.lastDisconnectAt = new Date().toISOString();
}

export function recordSSERefused(): void {
  state.sse.totalConnectionsRefused++;
  state.sse.lastRefusedAt = new Date().toISOString();
}

export function setSSEMaxConnections(max: number): void {
  state.sse.maxConnections = max;
}

export function incrementSSEEventsSent(): void {
  state.sse.eventsSent++;
}

export function incrementSSEErrors(): void {
  state.sse.errors++;
}

/* ------------------------------------------------------------------ */
/* Alert Scheduler metrics                                             */
/* ------------------------------------------------------------------ */

export function getSchedulerStatus(): SchedulerStatus {
  let status: ComponentStatus = 'ok';
  if (state.scheduler.lastError) {
    status = 'degraded';
  }

  return {
    status,
    active: state.scheduler.active,
    lastRunAt: state.scheduler.lastRunAt,
    lastDurationMs: state.scheduler.lastDurationMs,
    lastAlertsProcessed: state.scheduler.lastAlertsProcessed,
    lastError: state.scheduler.lastError,
  };
}

export function setSchedulerActive(active: boolean): void {
  state.scheduler.active = active;
}

export function recordSchedulerRun(durationMs: number, alertsProcessed: number): void {
  state.scheduler.lastRunAt = new Date().toISOString();
  state.scheduler.lastDurationMs = durationMs;
  state.scheduler.lastAlertsProcessed = alertsProcessed;
  state.scheduler.lastError = null;
}

export function recordSchedulerError(error: string): void {
  state.scheduler.lastError = error;
}

/* ------------------------------------------------------------------ */
/* API metrics (F2.2)                                                  */
/* ------------------------------------------------------------------ */

export function getAPIStatus(): APIStatus {
  const totalRequests = state.api.totalRequests;
  let status: ComponentStatus = 'ok';
  if (totalRequests > 0 && state.api.errors5xx / totalRequests > 0.05) {
    status = 'degraded';
  }

  return {
    status,
    totalRequests,
    errors4xx: state.api.errors4xx,
    errors5xx: state.api.errors5xx,
    averageResponseTime: totalRequests > 0
      ? Math.round(state.api.totalResponseTime / totalRequests)
      : 0,
    slowRequests: state.api.slowRequests,
    lastRequestAt: state.api.lastRequestAt,
  };
}

/** Registra o término de uma requisição HTTP (status + duração). */
export function recordApiRequest(statusCode: number, durationMs: number): void {
  state.api.totalRequests++;
  state.api.totalResponseTime += durationMs;
  state.api.lastRequestAt = new Date().toISOString();
  if (statusCode >= 400 && statusCode < 500) state.api.errors4xx++;
  if (statusCode >= 500) state.api.errors5xx++;
  if (durationMs > SLOW_REQUEST_THRESHOLD_MS) state.api.slowRequests++;
}

export function resetApiMetrics(): void {
  state.api.totalRequests = 0;
  state.api.errors4xx = 0;
  state.api.errors5xx = 0;
  state.api.totalResponseTime = 0;
  state.api.slowRequests = 0;
  state.api.lastRequestAt = null;
}

/* ------------------------------------------------------------------ */
/* Cache metrics (F2.2)                                                */
/* ------------------------------------------------------------------ */

export function getCacheStatus(): CacheStatus {
  const m = getCacheMetrics();
  return {
    status: 'ok',
    hits: m.hits,
    misses: m.misses,
    keys: m.keys,
    evictions: m.evictions,
    hitRate: m.hitRate,
  };
}

/** Sincroniza as métricas de cache a partir de lib/cache.ts (chamado sob demanda). */
/* ------------------------------------------------------------------ */
/* Rate limit metrics (F2.2)                                           */
/* ------------------------------------------------------------------ */

export function getRateLimitStatus(): RateLimitStatus {
  return {
    status: 'ok',
    blockedRequests: state.rateLimit.blockedRequests,
    lastBlockedAt: state.rateLimit.lastBlockedAt,
  };
}

/** Registra um bloqueio por rate limit (HTTP 429). */
export function recordRateLimitBlock(): void {
  state.rateLimit.blockedRequests++;
  state.rateLimit.lastBlockedAt = new Date().toISOString();
}

export function resetRateLimitMetrics(): void {
  state.rateLimit.blockedRequests = 0;
  state.rateLimit.lastBlockedAt = null;
}

/* ------------------------------------------------------------------ */
/* Job queue metrics (F2.2)                                            */
/* ------------------------------------------------------------------ */

export function getJobQueueStatus(): JobQueueStatus {
  let status: ComponentStatus = 'ok';
  if (state.jobQueue.lastError && state.jobQueue.pending > 0) {
    status = 'degraded';
  }

  return {
    status,
    pending: state.jobQueue.pending,
    running: state.jobQueue.running,
    succeeded: state.jobQueue.succeeded,
    failed: state.jobQueue.failed,
    retrying: state.jobQueue.retrying,
    lastRunAt: state.jobQueue.lastRunAt,
    lastRunDurationMs: state.jobQueue.lastRunDurationMs,
    lastError: state.jobQueue.lastError,
  };
}

/** Sincroniza contagens atuais (pending/running/retrying) após um ciclo do worker. */
export function recordJobQueueCounts(counts: {
  pending: number;
  running: number;
  retrying: number;
}): void {
  state.jobQueue.pending = counts.pending;
  state.jobQueue.running = counts.running;
  state.jobQueue.retrying = counts.retrying;
}

export function recordJobCompleted(): void {
  state.jobQueue.succeeded++;
}

export function recordJobFailed(): void {
  state.jobQueue.failed++;
}

export function recordJobRetried(): void {
  state.jobQueue.retrying++;
}

export function recordJobQueueRun(durationMs: number): void {
  state.jobQueue.lastRunAt = new Date().toISOString();
  state.jobQueue.lastRunDurationMs = durationMs;
  state.jobQueue.lastError = null;
}

export function recordJobQueueError(error: string): void {
  state.jobQueue.lastError = error;
}

export function resetJobQueueMetrics(): void {
  state.jobQueue.pending = 0;
  state.jobQueue.running = 0;
  state.jobQueue.succeeded = 0;
  state.jobQueue.failed = 0;
  state.jobQueue.retrying = 0;
  state.jobQueue.lastRunAt = null;
  state.jobQueue.lastRunDurationMs = null;
  state.jobQueue.lastError = null;
}

/* ------------------------------------------------------------------ */
/* Composite health report                                             */
/* ------------------------------------------------------------------ */

function computeOverallStatus(components: ComponentStatus[]): ComponentStatus {
  if (components.includes('down')) return 'down';
  if (components.includes('degraded')) return 'degraded';
  return 'ok';
}

export function getHealthReport(): HealthReport {
  const database = getDatabaseStatus();
  const postgresListener = getListenerStatus();
  const eventBus = getEventBusStatus();
  const sse = getSSEStatus();
  const scheduler = getSchedulerStatus();
  const api = getAPIStatus();
  const cache = getCacheStatus();
  const rateLimit = getRateLimitStatus();
  const jobQueue = getJobQueueStatus();

  const overall = computeOverallStatus([
    database.status,
    postgresListener.status,
    eventBus.status,
    sse.status,
    scheduler.status,
    api.status,
    cache.status,
    rateLimit.status,
    jobQueue.status,
  ]);

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version: '2.0.0',
    database,
    postgresListener,
    eventBus,
    sse,
    scheduler,
    api,
    cache,
    rateLimit,
    jobQueue,
  };
}

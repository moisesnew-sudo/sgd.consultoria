/**
 * Fase D1.5a — Event Bus central de integrações.
 *
 * Fonte única para distribuição de eventos de integração.
 * Posteriormente será consumido por SSE e PostgreSQL LISTEN/NOTIFY.
 *
 * Segurança: payloads contêm somente metadados. Nunca incluem
 * config, secrets, tokens, credenciais ou environment variables.
 */

import { EventEmitter } from 'events';
import { logger } from './logger.js';
import {
  incrementEventsPublished,
  incrementEventsReceived,
  incrementEventBusErrors,
  setActiveListenerCount,
} from './healthStatus.js';

/* ------------------------------------------------------------------ */
/* Tipos de eventos e payloads                                        */
/* ------------------------------------------------------------------ */

export interface IntegrationCreatedPayload {
  systemId: number;
  code: string;
  name: string;
}

export interface IntegrationUpdatedPayload {
  systemId: number;
  code: string;
  changes: string[];
}

export interface IntegrationToggledPayload {
  systemId: number;
  code: string;
  active: boolean;
}

export interface IntegrationSyncedPayload {
  systemId: number;
  status: 'success' | 'failure' | 'timeout';
  durationMs: number;
}

export interface IntegrationHealthPayload {
  systemId: number;
  health: 'operational' | 'attention' | 'failure';
  lastSyncAt: string | null;
}

export interface IntegrationLogPayload {
  systemId: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface IntegrationAlertPayload {
  systemId: number;
  alertType: string;
  status: 'open' | 'acknowledged' | 'resolved';
}

export interface IntegrationHeartbeatPayload {
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/* Eventos de Demandas (D1.6)                                         */
/* ------------------------------------------------------------------ */

export interface DemandCreatedPayload {
  demandId: string;
  title: string;
  status: string;
  municipality: string;
  uf: string;
}

export interface DemandUpdatedPayload {
  demandId: string;
  title: string;
  changes: string[];
}

export interface DemandStatusChangedPayload {
  demandId: string;
  title: string;
  from: string;
  to: string;
}

export interface DemandDeletedPayload {
  demandId: string;
  title: string;
}

export interface CommentCreatedPayload {
  demandId: string;
  commentId: number;
  userName: string;
}

/** Mapa discriminado: evento → payload */
export interface IntegrationEventPayloads {
  'integration:created': IntegrationCreatedPayload;
  'integration:updated': IntegrationUpdatedPayload;
  'integration:toggled': IntegrationToggledPayload;
  'integration:synced': IntegrationSyncedPayload;
  'integration:health': IntegrationHealthPayload;
  'integration:log': IntegrationLogPayload;
  'integration:alert': IntegrationAlertPayload;
  'integration:heartbeat': IntegrationHeartbeatPayload;
  'demand:created': DemandCreatedPayload;
  'demand:updated': DemandUpdatedPayload;
  'demand:status_changed': DemandStatusChangedPayload;
  'demand:deleted': DemandDeletedPayload;
  'comment:created': CommentCreatedPayload;
}

export type IntegrationEventName = keyof IntegrationEventPayloads;
export type IntegrationEventListener<K extends IntegrationEventName> =
  (payload: IntegrationEventPayloads[K]) => void;

/* ------------------------------------------------------------------ */
/* Event Bus singleton                                                */
/* ------------------------------------------------------------------ */

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const VALID_EVENT_NAMES: readonly string[] = [
  'integration:created', 'integration:updated', 'integration:toggled',
  'integration:synced', 'integration:health', 'integration:log',
  'integration:alert', 'integration:heartbeat',
  'demand:created', 'demand:updated', 'demand:status_changed', 'demand:deleted',
  'comment:created',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeListeners = new Map<string, { event: IntegrationEventName; listener: (...args: any[]) => void }>();

let idCounter = 0;

/* ------------------------------------------------------------------ */
/* PostgreSQL NOTIFY bridge (D1.7)                                     */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notifyFn: ((event: string, payload: any) => Promise<void>) | null = null;

/**
 * Registra a função de NOTIFY do PostgreSQL.
 * Chamado por eventBusPostgres.startPostgresListener() para evitar dependência circular.
 */
export function registerPostgresNotify(fn: (event: string, payload: unknown) => Promise<void>): void {
  notifyFn = fn;
}

/**
 * Emite um evento de integração (somente local).
 * Tipado: só aceita o payload correspondente ao evento.
 */
export function emitIntegrationEvent<K extends IntegrationEventName>(
  event: K,
  payload: IntegrationEventPayloads[K],
): void {
  try {
    emitter.emit(event, payload);
    incrementEventsReceived();
  } catch (err) {
    logger.error('eventBus: error emitting event', {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
    incrementEventBusErrors();
  }
}

/**
 * Publica um evento: emite localmente E notifica outras instâncias via PostgreSQL NOTIFY.
 * Usado pelas rotas para garantir sincronização multi-instância.
 */
export async function publishEvent<K extends IntegrationEventName>(
  event: K,
  payload: IntegrationEventPayloads[K],
): Promise<void> {
  emitIntegrationEvent(event, payload);
  incrementEventsPublished();
  if (notifyFn) {
    try {
      await notifyFn(event, payload);
    } catch (err) {
      logger.error('eventBus: postgres notify failed', {
        event,
        error: err instanceof Error ? err.message : String(err),
      });
      incrementEventBusErrors();
    }
  }
}

/**
 * Retorna a lista de nomes de eventos suportados (para validação no listener).
 */
export function getEventNames(): readonly string[] {
  return VALID_EVENT_NAMES;
}

/**
 * Registra listener para um evento específico.
 * Retorna um id para remoção posterior via offIntegrationEvent.
 */
export function onIntegrationEvent<K extends IntegrationEventName>(
  event: K,
  listener: IntegrationEventListener<K>,
): string {
  const id = String(++idCounter);
  const safeListener = (payload: IntegrationEventPayloads[K]) => {
    try {
      listener(payload);
    } catch (err) {
      logger.error('eventBus: listener error', {
        event,
        listenerId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  activeListeners.set(id, { event, listener: safeListener });
  emitter.on(event, safeListener);
  setActiveListenerCount(activeListeners.size);
  return id;
}

/**
 * Remove um listener pelo id retornado por onIntegrationEvent.
 */
export function offIntegrationEvent(id: string): void {
  const entry = activeListeners.get(id);
  if (entry) {
    emitter.removeListener(entry.event, entry.listener);
    activeListeners.delete(id);
    setActiveListenerCount(activeListeners.size);
  }
}

/**
 * Convenience: registra listener e retorna id (alias de onIntegrationEvent).
 */
export function subscribe<K extends IntegrationEventName>(
  event: K,
  listener: IntegrationEventListener<K>,
): string {
  return onIntegrationEvent(event, listener);
}

/**
 * Convenience: remove listener pelo id (alias de offIntegrationEvent).
 */
export function unsubscribe(id: string): void {
  offIntegrationEvent(id);
}

/**
 * Retorna a quantidade de listeners ativos (para diagnóstico/testes).
 */
export function getListenerCount(): number {
  return activeListeners.size;
}

/**
 * Remove todos os listeners. Útil para cleanup em testes.
 */
export function removeAllListeners(): void {
  for (const [id, entry] of activeListeners) {
    emitter.removeListener(entry.event, entry.listener);
  }
  activeListeners.clear();
  emitter.removeAllListeners();
  setActiveListenerCount(0);
}

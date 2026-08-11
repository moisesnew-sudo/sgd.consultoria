/**
 * Fase F2.2 — Cache Operacional.
 *
 * Cache em memória (singleton) com:
 * - TTL configurável por ENV (CACHE_DEFAULT_TTL_MS);
 * - métricas hit/miss e tamanho (chaves ativas);
 * - invalidação manual por padrão exato ou por prefixo;
 * - invalidação por evento (demand:updated, demand:created, demand:deleted,
 *   integration:* etc.) via eventBus — mantém stats/dashboards coerentes.
 *
 * Limites de segurança:
 * - MAX_CACHE_KEYS (padrão 1000) — evita crescimento ilimitado em memória;
 * - limpeza periódica de entradas expiradas.
 *
 * Segurança: cache guarda APENAS dados já autorizados (agregados, listas),
 * nunca segredos, tokens, cookies ou credenciais.
 */

import { logger } from './logger.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export const DEFAULT_TTL_MS = envInt('CACHE_DEFAULT_TTL_MS', 60_000);
const MAX_CACHE_KEYS = envInt('CACHE_MAX_KEYS', 1000);

const store = new Map<string, CacheEntry<any>>();

/* ------------------------------------------------------------------ */
/* Métricas                                                            */
/* ------------------------------------------------------------------ */

const metrics = {
  hits: 0,
  misses: 0,
  evictions: 0,
};

export function getCacheMetrics() {
  return {
    hits: metrics.hits,
    misses: metrics.misses,
    keys: store.size,
    evictions: metrics.evictions,
    hitRate: metrics.hits + metrics.misses > 0
      ? metrics.hits / (metrics.hits + metrics.misses)
      : 0,
    defaultTtlMs: DEFAULT_TTL_MS,
    maxKeys: MAX_CACHE_KEYS,
  };
}

export function resetCacheMetrics(): void {
  metrics.hits = 0;
  metrics.misses = 0;
  metrics.evictions = 0;
}

/* ------------------------------------------------------------------ */
/* Operações principais                                                */
/* ------------------------------------------------------------------ */

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) {
    metrics.misses++;
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    metrics.misses++;
    return undefined;
  }
  metrics.hits++;
  return entry.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  // Evita crescimento ilimitado: remove a entrada mais antiga se estiver no teto.
  if (!store.has(key) && store.size >= MAX_CACHE_KEYS) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest) {
      store.delete(oldest);
      metrics.evictions++;
    }
  }
  store.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
}

/** Remove entradas por prefixo (ex.: 'dashboard-stats', 'executive-stats'). */
export function clearCache(pattern?: string): void {
  if (!pattern) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.includes(pattern)) store.delete(key);
  }
}

/** Remove uma chave exata. Retorna true se havia algo em cache. */
export function invalidateCache(key: string): boolean {
  const existed = store.delete(key);
  if (existed) {
    logger.debug('cache: invalidated', { key });
  }
  return existed;
}

/** Remove por prefixo exato (início da chave). Retorna quantas chaves removidas. */
export function invalidateCacheByPrefix(prefix: string): number {
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug('cache: invalidated by prefix', { prefix, removed });
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* Invalidação por evento (eventBus)                                   */
/* ------------------------------------------------------------------ */

const EVENT_TO_PREFIXES: Record<string, string[]> = {
  'demand:created': ['dashboard-stats', 'executive-stats'],
  'demand:updated': ['dashboard-stats', 'executive-stats'],
  'demand:status_changed': ['dashboard-stats', 'executive-stats'],
  'demand:deleted': ['dashboard-stats', 'executive-stats'],
  'integration:created': ['integrations'],
  'integration:updated': ['integrations'],
  'integration:toggled': ['integrations'],
  'integration:synced': ['integrations'],
};

/**
 * Registra a invalidação por evento no eventBus.
 * Idempotente: liga os listeners apenas uma vez por processo.
 * Chamado no startup do servidor (server.ts).
 */
export function registerCacheInvalidation(): void {
  if (cacheInvalidationRegistered) return;
  cacheInvalidationRegistered = true;

  import('./eventBus.js').then(({ onIntegrationEvent }) => {
    for (const [eventName, prefixes] of Object.entries(EVENT_TO_PREFIXES)) {
      onIntegrationEvent(eventName as never, () => {
        for (const prefix of prefixes) {
          invalidateCacheByPrefix(prefix);
        }
      });
    }
    logger.info('cache: invalidation por evento registrada');
  }).catch((err) => {
    logger.error('cache: falha ao registrar invalidação por evento', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

let cacheInvalidationRegistered = false;

/* ------------------------------------------------------------------ */
/* Limpeza periódica de entradas expiradas                             */
/* ------------------------------------------------------------------ */

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, DEFAULT_TTL_MS).unref();

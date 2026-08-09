/**
 * Fase D2.2 — Testes do Avaliador de Saúde do Sistema.
 *
 * Cobertura:
 * 1. evaluateHealthConditions: database down → critical
 * 2. evaluateHealthConditions: database degraded → warning
 * 3. evaluateHealthConditions: listener down → critical
 * 4. evaluateHealthConditions: eventbus degraded → warning
 * 5. evaluateHealthConditions: sse degraded → warning
 * 6. evaluateHealthConditions: scheduler error com tolerância
 * 7. evaluateHealthConditions: tudo ok → array vazio
 * 8. evaluateHealthConditions: múltiplas condições simultâneas
 * 9. upsertHealthAlert: cria novo alerta
 * 10. upsertHealthAlert: atualiza alerta existente (coalescing)
 * 11. resolveHealthAlert: resolve alerta ativo
 * 12. resolveHealthAlert: retorna false se não existe alerta
 * 13. loadActiveHealthAlerts: retorna alertas do sistema sentinela
 * 14. runHealthEvaluation: integração completa
 * 15. ensureHealthMonitorSystem: cria sistema sentinela
 * 16. ensureHealthMonitorSystem: reutiliza sistema existente
 * 17. ensureHealthMonitorSystem: cache funciona
 * 18. runHealthEvaluation: não falha se healthStatus lança erro
 * 19. health alerts não expõem dados sensíveis
 * 20. scheduler error com tolerância < threshold não gera alerta
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pool, run, get, all } from '../database.js';
import {
  evaluateHealthConditions,
  ensureHealthMonitorSystem,
  resetHealthMonitorCache,
  upsertHealthAlert,
  resolveHealthAlert,
  loadActiveHealthAlerts,
  runHealthEvaluation,
  HEALTH_MONITOR_CODE,
} from '../lib/healthEvaluator.js';
import type { HealthAlertType, HealthCondition } from '../lib/healthEvaluator.js';
import type { DatabaseStatus, HealthReport } from '../lib/healthStatus.js';

/* ------------------------------------------------------------------ */
/* Mocks — healthStatus (top-level, hoisted by vitest)                 */
/* ------------------------------------------------------------------ */

const mockGetDatabaseStatus = vi.fn().mockReturnValue({
  status: 'ok', totalConnections: 5, idleConnections: 3, waitingClients: 0,
});
const mockGetListenerStatus = vi.fn().mockReturnValue({
  status: 'ok', connected: true, originId: 'test', lastNotificationAt: null, reconnectCount: 0,
});
const mockGetEventBusStatus = vi.fn().mockReturnValue({
  status: 'ok', eventsPublished: 0, eventsReceived: 0, errors: 0, lastEventAt: null, activeListeners: 0,
});
const mockGetSSEStatus = vi.fn().mockReturnValue({
  status: 'ok', activeConnections: 0, totalConnectionsOpened: 0, totalConnectionsClosed: 0, eventsSent: 0, errors: 0, lastConnectAt: null, lastDisconnectAt: null,
});
const mockGetSchedulerStatus = vi.fn().mockReturnValue({
  status: 'ok', active: true, lastRunAt: null, lastDurationMs: null, lastAlertsProcessed: null, lastError: null,
});
const mockGetAPIStatus = vi.fn().mockReturnValue({
  status: 'ok', totalRequests: 0, errors4xx: 0, errors5xx: 0, averageResponseTime: 0, slowRequests: 0, lastRequestAt: null,
});
const mockGetCacheStatus = vi.fn().mockReturnValue({
  status: 'ok', hits: 0, misses: 0, keys: 0, evictions: 0, hitRate: 0,
});
const mockGetRateLimitStatus = vi.fn().mockReturnValue({
  status: 'ok', blockedRequests: 0, lastBlockedAt: null,
});
const mockGetJobQueueStatus = vi.fn().mockReturnValue({
  status: 'ok', pending: 0, running: 0, succeeded: 0, failed: 0, retrying: 0, lastRunAt: null, lastRunDurationMs: null, lastError: null,
});

vi.mock('../lib/healthStatus.js', () => ({
  getDatabaseStatus: (...args: any[]) => mockGetDatabaseStatus(...args),
  getListenerStatus: (...args: any[]) => mockGetListenerStatus(...args),
  getEventBusStatus: (...args: any[]) => mockGetEventBusStatus(...args),
  getSSEStatus: (...args: any[]) => mockGetSSEStatus(...args),
  getSchedulerStatus: (...args: any[]) => mockGetSchedulerStatus(...args),
  getAPIStatus: (...args: any[]) => mockGetAPIStatus(...args),
  getCacheStatus: (...args: any[]) => mockGetCacheStatus(...args),
  getRateLimitStatus: (...args: any[]) => mockGetRateLimitStatus(...args),
  getJobQueueStatus: (...args: any[]) => mockGetJobQueueStatus(...args),
}));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type ReportOverrides = Omit<Partial<HealthReport>, 'database'> & {
  database?: Partial<DatabaseStatus>;
};

function makeReport(overrides: ReportOverrides = {}): HealthReport {
  const base: HealthReport = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: 1000,
    version: '2.0.0',
    database: {
      status: 'ok',
      totalConnections: 5,
      idleConnections: 3,
      waitingClients: 0,
      poolSaturation: 0.25,
      slowQueries: 0,
    },
    postgresListener: {
      status: 'ok',
      connected: true,
      originId: 'test-origin',
      lastNotificationAt: null,
      reconnectCount: 0,
      lostEvents: 0,
      lastReconnectReason: null,
    },
    eventBus: {
      status: 'ok',
      eventsPublished: 10,
      eventsReceived: 10,
      errors: 0,
      lastEventAt: null,
      activeListeners: 1,
    },
    sse: {
      status: 'ok',
      activeConnections: 2,
      totalConnectionsOpened: 10,
      totalConnectionsClosed: 8,
      totalConnectionsRefused: 0,
      maxConnections: 100,
      eventsSent: 50,
      errors: 0,
      lastConnectAt: null,
      lastDisconnectAt: null,
      lastRefusedAt: null,
    },
    scheduler: {
      status: 'ok',
      active: true,
      lastRunAt: null,
      lastDurationMs: null,
      lastAlertsProcessed: null,
      lastError: null,
    },
    api: {
      status: 'ok',
      totalRequests: 0,
      errors4xx: 0,
      errors5xx: 0,
      averageResponseTime: 0,
      slowRequests: 0,
      lastRequestAt: null,
    },
    cache: {
      status: 'ok',
      hits: 0,
      misses: 0,
      keys: 0,
      evictions: 0,
      hitRate: 0,
    },
    rateLimit: {
      status: 'ok',
      blockedRequests: 0,
      lastBlockedAt: null,
    },
    jobQueue: {
      status: 'ok',
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      retrying: 0,
      lastRunAt: null,
      lastRunDurationMs: null,
      lastError: null,
    },
  };
  return {
    ...base,
    ...overrides,
    database: { ...base.database, ...overrides.database },
  };
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

afterEach(async () => {
  resetHealthMonitorCache();
  await run(`DELETE FROM integration_alerts WHERE system_id IN (
    SELECT id FROM integration_systems WHERE code = $1
  )`, [HEALTH_MONITOR_CODE]);
});

/* ------------------------------------------------------------------ */
/* 1–8: evaluateHealthConditions (pure)                                */
/* ------------------------------------------------------------------ */

describe('healthEvaluator — evaluateHealthConditions', () => {
  it('1. database down → critical', () => {
    const report = makeReport({
      database: { status: 'down', totalConnections: 0, idleConnections: 0, waitingClients: 0 },
    });
    const conditions = evaluateHealthConditions(report);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].type).toBe('health:database_down');
    expect(conditions[0].severity).toBe('critical');
    expect(conditions[0].triggered).toBe(true);
  });

  it('2. database degraded → warning', () => {
    const report = makeReport({
      database: { status: 'degraded', totalConnections: 10, idleConnections: 2, waitingClients: 8 },
    });
    const conditions = evaluateHealthConditions(report);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].type).toBe('health:database_degraded');
    expect(conditions[0].severity).toBe('warning');
  });

  it('3. listener down → critical', () => {
    const report = makeReport({
      postgresListener: {
        status: 'down',
        connected: false,
        originId: '',
        lastNotificationAt: null,
        reconnectCount: 5,
        lostEvents: 2,
        lastReconnectReason: 'connect_failed',
      },
    });
    const conditions = evaluateHealthConditions(report);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].type).toBe('health:listener_down');
    expect(conditions[0].severity).toBe('critical');
  });

  it('4. eventbus degraded → warning', () => {
    const report = makeReport({
      eventBus: {
        status: 'degraded',
        eventsPublished: 100,
        eventsReceived: 90,
        errors: 150,
        lastEventAt: null,
        activeListeners: 1,
      },
    });
    const conditions = evaluateHealthConditions(report);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].type).toBe('health:eventbus_degraded');
    expect(conditions[0].severity).toBe('warning');
  });

  it('5. sse degraded → warning', () => {
    const report = makeReport({
      sse: {
        status: 'degraded',
        activeConnections: 0,
        totalConnectionsOpened: 100,
        totalConnectionsClosed: 100,
        totalConnectionsRefused: 0,
        maxConnections: 100,
        eventsSent: 500,
        errors: 60,
        lastConnectAt: null,
        lastDisconnectAt: null,
        lastRefusedAt: null,
      },
    });
    const conditions = evaluateHealthConditions(report);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].type).toBe('health:sse_degraded');
    expect(conditions[0].severity).toBe('warning');
  });

  it('6. scheduler error com tolerância atingida → warning', () => {
    const report = makeReport({
      scheduler: {
        status: 'degraded',
        active: true,
        lastRunAt: null,
        lastDurationMs: null,
        lastAlertsProcessed: null,
        lastError: 'Connection refused',
      },
    });
    const conditions = evaluateHealthConditions(report, 2);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].type).toBe('health:scheduler_error');
    expect(conditions[0].severity).toBe('warning');
  });

  it('7. tudo ok → array vazio', () => {
    const report = makeReport();
    const conditions = evaluateHealthConditions(report);
    expect(conditions).toHaveLength(0);
  });

  it('8. múltiplas condições simultâneas', () => {
    const report = makeReport({
      database: { status: 'down', totalConnections: 0, idleConnections: 0, waitingClients: 0 },
      postgresListener: {
        status: 'down',
        connected: false,
        originId: '',
        lastNotificationAt: null,
        reconnectCount: 3,
        lostEvents: 1,
        lastReconnectReason: 'connection_error',
      },
      sse: {
        status: 'degraded',
        activeConnections: 0,
        totalConnectionsOpened: 50,
        totalConnectionsClosed: 50,
        totalConnectionsRefused: 0,
        maxConnections: 100,
        eventsSent: 200,
        errors: 60,
        lastConnectAt: null,
        lastDisconnectAt: null,
        lastRefusedAt: null,
      },
    });
    const conditions = evaluateHealthConditions(report);
    expect(conditions).toHaveLength(3);
    const types = conditions.map((c) => c.type);
    expect(types).toContain('health:database_down');
    expect(types).toContain('health:listener_down');
    expect(types).toContain('health:sse_degraded');
  });
});

/* ------------------------------------------------------------------ */
/* 9–12: Persistência                                                  */
/* ------------------------------------------------------------------ */

describe('healthEvaluator — persistência', () => {
  it('9. upsertHealthAlert cria novo alerta', async () => {
    const condition: HealthCondition = {
      type: 'health:database_down',
      triggered: true,
      severity: 'critical',
      message: 'Banco de dados indisponível',
    };
    const result = await upsertHealthAlert(condition, new Date());
    expect(result).toBe('created');

    const systemId = await ensureHealthMonitorSystem();
    const alert = await get<{ type: string; severity: string; status: string }>(
      `SELECT type, severity, status FROM integration_alerts
       WHERE system_id = $1 AND type = 'health:database_down'`,
      [systemId]
    );
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('critical');
    expect(alert!.status).toBe('open');
  });

  it('10. upsertHealthAlert atualiza alerta existente (coalescing)', async () => {
    const condition: HealthCondition = {
      type: 'health:listener_down',
      triggered: true,
      severity: 'critical',
      message: 'Listener desconectado',
    };
    await upsertHealthAlert(condition, new Date());
    const result = await upsertHealthAlert(condition, new Date());
    expect(result).toBe('updated');

    const systemId = await ensureHealthMonitorSystem();
    const alerts = await all<{ id: number }>(
      `SELECT id FROM integration_alerts
       WHERE system_id = $1 AND type = 'health:listener_down' AND status IN ('open', 'acknowledged')`,
      [systemId]
    );
    expect(alerts).toHaveLength(1);
  });

  it('11. resolveHealthAlert resolve alerta ativo', async () => {
    const condition: HealthCondition = {
      type: 'health:sse_degraded',
      triggered: true,
      severity: 'warning',
      message: 'SSE degradado',
    };
    await upsertHealthAlert(condition, new Date());
    const resolved = await resolveHealthAlert('health:sse_degraded', 'condição recuperada', new Date());
    expect(resolved).toBe(true);

    const systemId = await ensureHealthMonitorSystem();
    const alert = await get<{ status: string }>(
      `SELECT status FROM integration_alerts
       WHERE system_id = $1 AND type = 'health:sse_degraded'`,
      [systemId]
    );
    expect(alert!.status).toBe('resolved');
  });

  it('12. resolveHealthAlert retorna false se não existe alerta', async () => {
    const resolved = await resolveHealthAlert('health:eventbus_degraded', 'não existe', new Date());
    expect(resolved).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 13: loadActiveHealthAlerts                                          */
/* ------------------------------------------------------------------ */

describe('healthEvaluator — loadActiveHealthAlerts', () => {
  it('13. retorna alertas do sistema sentinela', async () => {
    await upsertHealthAlert(
      { type: 'health:database_down', triggered: true, severity: 'critical', message: 'DB down' },
      new Date()
    );
    await upsertHealthAlert(
      { type: 'health:listener_down', triggered: true, severity: 'critical', message: 'Listener down' },
      new Date()
    );

    const alerts = await loadActiveHealthAlerts();
    expect(alerts).toHaveLength(2);
    const types = alerts.map((a) => a.type);
    expect(types).toContain('health:database_down');
    expect(types).toContain('health:listener_down');
  });
});

/* ------------------------------------------------------------------ */
/* 14: runHealthEvaluation (integração)                                */
/* ------------------------------------------------------------------ */

describe('healthEvaluator — runHealthEvaluation', () => {
  it('14. integração completa: cria alertas quando há problemas', async () => {
    // Configurar mocks para estado degradado
    mockGetDatabaseStatus.mockReturnValue({
      status: 'down', totalConnections: 0, idleConnections: 0, waitingClients: 0,
    });
    mockGetListenerStatus.mockReturnValue({
      status: 'ok', connected: true, originId: 'test', lastNotificationAt: null, reconnectCount: 0,
    });
    mockGetEventBusStatus.mockReturnValue({
      status: 'ok', eventsPublished: 0, eventsReceived: 0, errors: 0, lastEventAt: null, activeListeners: 0,
    });
    mockGetSSEStatus.mockReturnValue({
      status: 'ok', activeConnections: 0, totalConnectionsOpened: 0, totalConnectionsClosed: 0, eventsSent: 0, errors: 0, lastConnectAt: null, lastDisconnectAt: null,
    });
    mockGetSchedulerStatus.mockReturnValue({
      status: 'ok', active: true, lastRunAt: null, lastDurationMs: null, lastAlertsProcessed: null, lastError: null,
    });

    const summary = await runHealthEvaluation(new Date());
    expect(summary.created).toBeGreaterThanOrEqual(1);
    expect(summary.evaluatedComponents).toBeGreaterThanOrEqual(1);
  });

  it('18. não falha se healthStatus lança erro', async () => {
    mockGetDatabaseStatus.mockImplementation(() => { throw new Error('healthStatus failure'); });
    mockGetListenerStatus.mockReturnValue({
      status: 'ok', connected: true, originId: '', lastNotificationAt: null, reconnectCount: 0,
    });
    mockGetEventBusStatus.mockReturnValue({
      status: 'ok', eventsPublished: 0, eventsReceived: 0, errors: 0, lastEventAt: null, activeListeners: 0,
    });
    mockGetSSEStatus.mockReturnValue({
      status: 'ok', activeConnections: 0, totalConnectionsOpened: 0, totalConnectionsClosed: 0, eventsSent: 0, errors: 0, lastConnectAt: null, lastDisconnectAt: null,
    });
    mockGetSchedulerStatus.mockReturnValue({
      status: 'ok', active: true, lastRunAt: null, lastDurationMs: null, lastAlertsProcessed: null, lastError: null,
    });

    const summary = await runHealthEvaluation(new Date());
    expect(summary.created).toBe(0);
    expect(summary.evaluatedComponents).toBe(0);

    // Restaurar para estado ok
    mockGetDatabaseStatus.mockReturnValue({
      status: 'ok', totalConnections: 5, idleConnections: 3, waitingClients: 0,
    });
  });
});

/* ------------------------------------------------------------------ */
/* 15–17: ensureHealthMonitorSystem                                    */
/* ------------------------------------------------------------------ */

describe('healthEvaluator — ensureHealthMonitorSystem', () => {
  it('15. cria sistema sentinela se não existe', async () => {
    resetHealthMonitorCache();
    await run(`DELETE FROM integration_systems WHERE code = $1`, [HEALTH_MONITOR_CODE]);
    const id = await ensureHealthMonitorSystem();
    expect(id).toBeGreaterThan(0);

    const sys = await get<{ code: string; name: string }>(
      `SELECT code, name FROM integration_systems WHERE id = $1`,
      [id]
    );
    expect(sys!.code).toBe(HEALTH_MONITOR_CODE);
    expect(sys!.name).toBe('SGD Health Monitor');
  });

  it('16. reutiliza sistema existente', async () => {
    const id1 = await ensureHealthMonitorSystem();
    const id2 = await ensureHealthMonitorSystem();
    expect(id1).toBe(id2);
  });

  it('17. cache funciona (chamadas múltiplas não insetam duplicatas)', async () => {
    await ensureHealthMonitorSystem();
    await ensureHealthMonitorSystem();
    await ensureHealthMonitorSystem();
    const count = await get<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM integration_systems WHERE code = $1`,
      [HEALTH_MONITOR_CODE]
    );
    expect(Number(count!.count)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 19: Segurança — nenhum segredo exposto                              */
/* ------------------------------------------------------------------ */

describe('healthEvaluator — segurança', () => {
  it('19. health alerts não expõem dados sensíveis', async () => {
    const condition: HealthCondition = {
      type: 'health:database_down',
      triggered: true,
      severity: 'critical',
      message: 'DB down',
    };
    await upsertHealthAlert(condition, new Date());

    const systemId = await ensureHealthMonitorSystem();
    const alert = await get<{ details: Record<string, unknown> }>(
      `SELECT details FROM integration_alerts
       WHERE system_id = $1 AND type = 'health:database_down'`,
      [systemId]
    );
    expect(alert).toBeDefined();
    const details = alert!.details;
    const jsonStr = JSON.stringify(details);
    expect(jsonStr).not.toMatch(/password|secret|token|key|credential/i);
  });
});

/* ------------------------------------------------------------------ */
/* 20: Scheduler tolerance                                             */
/* ------------------------------------------------------------------ */

describe('healthEvaluator — scheduler tolerance', () => {
  it('20. scheduler error com tolerância abaixo do threshold não gera alerta', () => {
    const report = makeReport({
      scheduler: {
        status: 'degraded',
        active: true,
        lastRunAt: null,
        lastDurationMs: null,
        lastAlertsProcessed: null,
        lastError: 'Connection refused',
      },
    });
    const conditions = evaluateHealthConditions(report, 1);
    expect(conditions).toHaveLength(0);
  });
});

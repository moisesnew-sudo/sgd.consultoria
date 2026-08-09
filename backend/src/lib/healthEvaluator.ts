/**
 * Fase D2.2 — Avaliador de Saúde do Sistema.
 *
 * Avalia as condições de saúde de cada componente (Database, PostgreSQL Listener,
 * Event Bus, SSE, Scheduler) contra thresholds configuráveis e gera alertas
 * na tabela integration_alerts usando o sistema sentinela `__sgd_health__`.
 *
 * Arquitetura:
 * - Lógica pura: evaluateHealthConditions() retorna ações (criar/atualizar/resolver)
 * - Persistência: upsertHealthAlert() / resolveHealthAlert() escrevem no banco
 * - Coalescing: mesmo mecanismo do alertEngine (UNIQUE parcial, occurrences)
 * - Deduplicação: mesmo padrão (system_id, type) WHERE status IN ('open','acknowledged')
 *
 * Sentinel: usa system_id de um sistema virtual `__sgd_health__` inserido via
 * ensureHealthMonitorSystem(). FK constraint do banco é respeitada.
 */

import { pool, all, run, get } from '../database.js';
import { logger } from './logger.js';
import {
  getDatabaseStatus,
  getListenerStatus,
  getEventBusStatus,
  getSSEStatus,
  getSchedulerStatus,
  getAPIStatus,
  getCacheStatus,
  getRateLimitStatus,
  getJobQueueStatus,
} from './healthStatus.js';
import type { ComponentStatus, HealthReport } from './healthStatus.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type HealthAlertType =
  | 'health:database_down'
  | 'health:database_degraded'
  | 'health:listener_down'
  | 'health:eventbus_degraded'
  | 'health:sse_degraded'
  | 'health:scheduler_error'
  | 'health:webhook_dead_letter'
  | 'health:webhook_endpoint_down'
  | 'health:jobqueue_degraded';

export interface HealthCondition {
  type: HealthAlertType;
  triggered: boolean;
  severity: 'critical' | 'warning';
  message: string;
}

export interface HealthEvaluationSummary {
  evaluatedComponents: number;
  created: number;
  updated: number;
  resolved: number;
  skipped: number;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Código único do sistema sentinela para alertas de saúde. */
export const HEALTH_MONITOR_CODE = '__sgd_health__';

/** Tolerância: scheduler com erro persistente por mais de 2 rodadas. */
const SCHEDULER_ERROR_THRESHOLD = 2;

/* ------------------------------------------------------------------ */
/* Sentry system — garante FK constraint                               */
/* ------------------------------------------------------------------ */

let cachedSystemId: number | null = null;

/**
 * Garante que o sistema sentinela __sgd_health__ existe.
 * Lazy: criado no primeiro acesso, cacheado em memória.
 */
export async function ensureHealthMonitorSystem(): Promise<number> {
  if (cachedSystemId !== null) return cachedSystemId;

  const existing = await get<{ id: number }>(
    `SELECT id FROM integration_systems WHERE code = $1`,
    [HEALTH_MONITOR_CODE]
  );
  if (existing) {
    cachedSystemId = existing.id;
    return cachedSystemId;
  }

  const result = await run(
    `INSERT INTO integration_systems (code, name, secret_env_key, active, config)
     VALUES ($1, 'SGD Health Monitor', 'HEALTH_MONITOR_SECRET_KEY', true, '{"type":"health_monitor"}'::jsonb)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [HEALTH_MONITOR_CODE]
  );
  cachedSystemId = result.rows[0].id as number;
  logger.info('Health monitor system created', { id: cachedSystemId });
  return cachedSystemId;
}

/** Limpa cache (para testes). */
export function resetHealthMonitorCache(): void {
  cachedSystemId = null;
}

/* ------------------------------------------------------------------ */
/* Lógica pura de avaliação                                            */
/* ------------------------------------------------------------------ */

/**
 * Avalia as condições de saúde de todos os componentes.
 * Função PURA (sem I/O): recebe o report e retorna a lista de condições.
 * A tolerância de scheduler é baseada no parâmetro schedulerConsecutiveErrors.
 */
export function evaluateHealthConditions(
  report: HealthReport,
  schedulerConsecutiveErrors: number = 0
): HealthCondition[] {
  const conditions: HealthCondition[] = [];

  // Database
  if (report.database.status === 'down') {
    conditions.push({
      type: 'health:database_down',
      triggered: true,
      severity: 'critical',
      message: 'Banco de dados indisponível: pool sem conexões ativas e/ou erro recente',
    });
  } else if (report.database.status === 'degraded') {
    conditions.push({
      type: 'health:database_degraded',
      triggered: true,
      severity: 'warning',
      message: `Banco de dados degradado: ${report.database.waitingClients} clientes aguardando conexão`,
    });
  }

  // PostgreSQL Listener
  if (report.postgresListener.status === 'down') {
    conditions.push({
      type: 'health:listener_down',
      triggered: true,
      severity: 'critical',
      message: 'PostgreSQL LISTEN/NOTIFY desconectado',
    });
  }

  // Event Bus
  if (report.eventBus.status === 'degraded') {
    conditions.push({
      type: 'health:eventbus_degraded',
      triggered: true,
      severity: 'warning',
      message: `Event Bus com erros acumulados: ${report.eventBus.errors} erros`,
    });
  }

  // SSE
  if (report.sse.status === 'degraded') {
    conditions.push({
      type: 'health:sse_degraded',
      triggered: true,
      severity: 'warning',
      message: `SSE com erros acumulados: ${report.sse.errors} erros`,
    });
  }

  // Scheduler — só alerta após tolerância (evita falso positivo em cold start)
  if (report.scheduler.lastError && schedulerConsecutiveErrors >= SCHEDULER_ERROR_THRESHOLD) {
    conditions.push({
      type: 'health:scheduler_error',
      triggered: true,
      severity: 'warning',
      message: `Alert Scheduler com erro persistente: ${report.scheduler.lastError}`,
    });
  }

  // Job Queue (F2.2) — degradada quando o worker reporta erro e há fila acumulada
  if (report.jobQueue.status === 'degraded') {
    conditions.push({
      type: 'health:jobqueue_degraded',
      triggered: true,
      severity: 'warning',
      message: `Job Queue degradada: ${report.jobQueue.pending} jobs pendentes${report.jobQueue.lastError ? ` (${report.jobQueue.lastError})` : ''}`,
    });
  }

  return conditions;
}

/**
 * Retorna a lista de alertas de saúde ativos (open/acknowledged) para o
 * sistema sentinela, tipados como HealthAlertType.
 */
export async function loadActiveHealthAlerts(): Promise<
  Array<{
    id: number;
    type: HealthAlertType;
    severity: 'critical' | 'warning';
    details: Record<string, unknown> | null;
  }>
> {
  const systemId = await ensureHealthMonitorSystem();
  const rows = await all<{
    id: number;
    type: string;
    severity: string;
    details: unknown;
  }>(
    `SELECT id, type, severity, details
     FROM integration_alerts
     WHERE system_id = $1 AND status IN ('open', 'acknowledged')`,
    [systemId]
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type as HealthAlertType,
    severity: r.severity as 'critical' | 'warning',
    details: r.details && typeof r.details === 'object' ? (r.details as Record<string, unknown>) : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Persistência                                                        */
/* ------------------------------------------------------------------ */

/**
 * Cria ou atualiza (coalesce) um alerta de saúde.
 * Usa o mesmo padrão ON CONFLICT do alertEngine.
 */
export async function upsertHealthAlert(
  condition: HealthCondition,
  now: Date
): Promise<'created' | 'updated' | 'skipped'> {
  const systemId = await ensureHealthMonitorSystem();

  const baseDetails = {
    rule: condition.type,
    type: condition.type,
    lastDetectedAt: now.toISOString(),
  };

  const result = await run(
    `INSERT INTO integration_alerts (system_id, severity, type, message, details, status, tenant_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'open', 1)
     ON CONFLICT (system_id, type) WHERE status IN ('open', 'acknowledged')
     DO UPDATE SET
       severity = EXCLUDED.severity,
       message = EXCLUDED.message,
       details = jsonb_set(
         jsonb_set(
           COALESCE(integration_alerts.details, '{}'::jsonb) || EXCLUDED.details,
           '{occurrences}',
           to_jsonb((COALESCE(integration_alerts.details->>'occurrences', '0')::int + 1))
         ),
         '{firstDetectedAt}',
         COALESCE(integration_alerts.details->'firstDetectedAt', EXCLUDED.details->'firstDetectedAt')
       ),
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      systemId,
      condition.severity,
      condition.type,
      condition.message,
      JSON.stringify(baseDetails),
    ]
  );

  const row = result.rows[0];
  if (!row) return 'skipped';
  return row.inserted === true || row.inserted === 't' ? 'created' : 'updated';
}

/**
 * Resolve (fecha) um alerta de saúde quando a condição melhora.
 */
export async function resolveHealthAlert(
  alertType: HealthAlertType,
  reason: string,
  now: Date
): Promise<boolean> {
  const systemId = await ensureHealthMonitorSystem();

  const previous = await get<{ id: number; details: unknown }>(
    `SELECT id, details FROM integration_alerts
     WHERE system_id = $1 AND type = $2 AND status IN ('open', 'acknowledged')
     LIMIT 1`,
    [systemId, alertType]
  );
  if (!previous) return false;

  const prevDetails = previous.details && typeof previous.details === 'object'
    ? (previous.details as Record<string, unknown>)
    : {};

  const resolvedDetails = {
    ...prevDetails,
    recovery: true,
    recoveredAt: now.toISOString(),
    previousSeverity: prevDetails.severity ?? 'unknown',
    recoveryReason: reason,
  };

  const result = await run(
    `UPDATE integration_alerts
     SET status = 'resolved', resolved_at = NOW(), details = $2::jsonb, updated_at = NOW()
     WHERE id = $1 AND status IN ('open', 'acknowledged')`,
    [previous.id, JSON.stringify(resolvedDetails)]
  );

  return (result.rowCount ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* D3.2 — Webhook Health Evaluation                                    */
/* ------------------------------------------------------------------ */

/**
 * Avalia a saúde dos webhooks de saída.
 * Consulta o banco diretamente (não é pura — requer I/O).
 * Retorna condições que devem ser avaliadas junto com as组件.
 */
async function evaluateWebhookHealth(): Promise<HealthCondition[]> {
  const conditions: HealthCondition[] = [];

  try {
    // Verifica webhooks com dead_letters nas últimas 24h
    const deadLetterRow = await get<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM webhook_deliveries
       WHERE status = 'dead_letter'
         AND created_at >= NOW() - INTERVAL '24 hours'`
    );
    const deadLetterCount = parseInt(deadLetterRow?.count ?? '0', 10);

    if (deadLetterCount >= 3) {
      conditions.push({
        type: 'health:webhook_dead_letter',
        triggered: true,
        severity: 'warning',
        message: `${deadLetterCount} entregas de webhooks em dead_letter nas últimas 24h`,
      });
    }

    // Verifica endpoints com falhas consecutivas (todos os webhooks)
    const failingRow = await get<{ count: string }>(
      `SELECT COUNT(DISTINCT webhook_id)::text AS count
       FROM webhook_deliveries
       WHERE status = 'dead_letter'
         AND created_at >= NOW() - INTERVAL '1 hour'`
    );
    const failingEndpoints = parseInt(failingRow?.count ?? '0', 10);

    if (failingEndpoints >= 2) {
      conditions.push({
        type: 'health:webhook_endpoint_down',
        triggered: true,
        severity: 'critical',
        message: `${failingEndpoints} endpoints de webhooks com falha persistente`,
      });
    }
  } catch {
    // Erro na avaliação de webhooks não deve impedir avaliação de componentes
  }

  return conditions;
}

/* ------------------------------------------------------------------ */
/* Orquestração                                                        */
/* ------------------------------------------------------------------ */

/**
 * Roda a avaliação de saúde completa.
 * Chamada pelo alertScheduler após runAlertEvaluation().
 */
export async function runHealthEvaluation(
  now: Date = new Date()
): Promise<HealthEvaluationSummary> {
  const summary: HealthEvaluationSummary = {
    evaluatedComponents: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    skipped: 0,
  };

  try {
    const report = computeHealthReport();
    const activeAlerts = await loadActiveHealthAlerts();
    const activeByType = new Map<HealthAlertType, typeof activeAlerts[0]>();
    for (const alert of activeAlerts) {
      activeByType.set(alert.type, alert);
    }

    // Tolerância do scheduler: conta erros consecutivos
    const schedulerErrors = activeAlerts.filter((a) => a.type === 'health:scheduler_error').length;

    const conditions = evaluateHealthConditions(report, schedulerErrors);
    summary.evaluatedComponents = conditions.length;

    // D3.2 — Avaliação de saúde dos webhooks de saída
    const webhookConditions = await evaluateWebhookHealth();
    conditions.push(...webhookConditions);
    summary.evaluatedComponents += webhookConditions.length;

    const triggeredTypes = new Set<HealthAlertType>();

    for (const condition of conditions) {
      if (condition.triggered) {
        triggeredTypes.add(condition.type);
        const existing = activeByType.get(condition.type);
        const result = await upsertHealthAlert(condition, now);
        if (result === 'created') summary.created += 1;
        else if (result === 'updated') summary.updated += 1;
        else summary.skipped += 1;
      }
    }

    // Recovery: resolver alertas cuja condição melhorou
    for (const [alertType, _alert] of activeByType) {
      if (triggeredTypes.has(alertType)) continue;
      const resolved = await resolveHealthAlert(alertType, 'condição recuperada', now);
      if (resolved) summary.resolved += 1;
    }

    logger.debug('Health evaluation completed', {
      evaluatedComponents: summary.evaluatedComponents,
      created: summary.created,
      updated: summary.updated,
      resolved: summary.resolved,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Health evaluation failed', { error: msg });
  }

  return summary;
}

/** Computa o report de saúde (lê do singleton healthStatus). */
function computeHealthReport(): HealthReport {
  const database = getDatabaseStatus();
  const postgresListener = getListenerStatus();
  const eventBus = getEventBusStatus();
  const sse = getSSEStatus();
  const scheduler = getSchedulerStatus();
  const api = getAPIStatus();
  const cache = getCacheStatus();
  const rateLimit = getRateLimitStatus();
  const jobQueue = getJobQueueStatus();

  const components: ComponentStatus[] = [
    database.status,
    postgresListener.status,
    eventBus.status,
    sse.status,
    scheduler.status,
    api.status,
    cache.status,
    rateLimit.status,
    jobQueue.status,
  ];

  let status: ComponentStatus = 'ok';
  if (components.includes('down')) status = 'down';
  else if (components.includes('degraded')) status = 'degraded';

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: 0,
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

export default {
  ensureHealthMonitorSystem,
  resetHealthMonitorCache,
  evaluateHealthConditions,
  loadActiveHealthAlerts,
  upsertHealthAlert,
  resolveHealthAlert,
  runHealthEvaluation,
  HEALTH_MONITOR_CODE,
};

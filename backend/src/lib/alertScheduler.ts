/**
 * Fase D1.4 / D2.2 — Scheduler de Avaliação de Alertas Inteligentes.
 *
 * Executa runAlertEvaluation() + runHealthEvaluation() em intervalos regulares,
 * com proteção via pg_advisory_lock (chave 738291045 — int32, exclusiva para
 * este scheduler) para evitar execução concorrente em múltiplas instâncias.
 *
 * Não criar timer se NODE_ENV=test.
 */

import { pool } from '../database.js';
import { runAlertEvaluation } from './alertEngine.js';
import { runHealthEvaluation } from './healthEvaluator.js';
import { logger } from './logger.js';
import type { AlertEvaluationSummary } from './alertEngine.js';
import {
  setSchedulerActive,
  recordSchedulerRun,
  recordSchedulerError,
} from './healthStatus.js';

/** Valor único de chave advisory lock (int32). */
const ALERT_LOCK_KEY = 738291045;

/** Intervalo padrão: 5 minutos (300000 ms). */
const DEFAULT_INTERVAL_MS = 300_000;

let timerRef: ReturnType<typeof setInterval> | null = null;

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

export function startAlertScheduler(intervalMs?: number): void {
  if (timerRef !== null) return;

  const ms = intervalMs ?? parseInterval();
  logger.info('Alert scheduler started', {
    intervalMs: ms,
    intervalMin: +(ms / 60_000).toFixed(1),
    pid: process.pid,
  });

  setSchedulerActive(true);
  timerRef = setInterval(() => {
    void runScheduledAlertEvaluation();
  }, ms);
}

export function stopAlertScheduler(): void {
  if (timerRef === null) return;
  clearInterval(timerRef);
  timerRef = null;
  setSchedulerActive(false);
  logger.debug('Alert scheduler stopped');
}

export async function runScheduledAlertEvaluation(): Promise<AlertEvaluationSummary | null> {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
      [ALERT_LOCK_KEY]
    );
    lockAcquired = lockResult.rows[0].pg_try_advisory_lock;

    if (!lockAcquired) {
      logger.debug('Alert evaluation skipped: another instance is running');
      return null;
    }

    logger.info('Alert evaluation started');
    const startedAt = Date.now();

    const summary = await runAlertEvaluation();

    // D2.2: Avaliação de saúde do sistema (após alertas de integração)
    const healthSummary = await runHealthEvaluation();

    const totalDuration = Date.now() - startedAt;
    logger.info('Alert evaluation completed', {
      durationMs: totalDuration,
      evaluatedSystems: summary.evaluatedSystems,
      alertsCreated: summary.created,
      alertsUpdated: summary.updated,
      alertsRecovered: summary.resolved,
      alertsSkipped: summary.skipped,
      healthEvaluatedComponents: healthSummary.evaluatedComponents,
      healthCreated: healthSummary.created,
      healthResolved: healthSummary.resolved,
    });

    recordSchedulerRun(totalDuration, summary.created + summary.updated + summary.resolved + healthSummary.created + healthSummary.resolved);
    return summary;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Alert evaluation failed', { error: errorMsg });
    recordSchedulerError(errorMsg);
    return null;
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ALERT_LOCK_KEY]);
      } catch {
        // unlock failure is non-fatal (session release will free anyway)
      }
    }
    client.release();
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function parseInterval(): number {
  const raw = process.env.ALERT_EVALUATION_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1_000) return DEFAULT_INTERVAL_MS;
  return Math.floor(n);
}

export { ALERT_LOCK_KEY, DEFAULT_INTERVAL_MS };

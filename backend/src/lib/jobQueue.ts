/**
 * Fase F2.2 — Job Queue (fila assíncrona institucional).
 *
 * Fila de trabalho persistida em PostgreSQL com:
 * - Retry/backoff exponencial com jitter (controlado por job);
 * - Auditoria de cada execução (audit_logs);
 * - Integração com healthStatus (contadores e saúde da fila);
 * - Compatibilidade futura com worker distribuído: claim atômico via
 *   FOR UPDATE SKIP LOCKED + ownership explícito (locked_by/locked_at).
 *
 * NÃO substitui os fluxos existentes (alertScheduler, integrationScheduler,
 * webhookDispatcher): é infraestrutura complementar para trabalho assíncrono.
 */

import crypto from 'crypto';
import { pool, run } from '../database.js';
import { logAudit } from './audit.js';
import { logger } from './logger.js';
import {
  recordJobQueueCounts,
  recordJobCompleted,
  recordJobFailed,
  recordJobRetried,
  recordJobQueueRun,
  recordJobQueueError,
} from './healthStatus.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type JobStatus = 'pending' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'cancelled';

export interface JobContext {
  jobId: number;
  type: string;
  queue: string;
  attempts: number;
  maxAttempts: number;
}

export type JobHandler = (
  payload: Record<string, unknown>,
  ctx: JobContext,
) => Promise<void> | void;

export interface EnqueueJobInput {
  type: string;
  payload?: Record<string, unknown>;
  queue?: string;
  maxAttempts?: number;
  runAt?: Date;
  createdBy?: number;
  tenantId?: number;
}

export interface BackgroundJob {
  id: number;
  queue: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error: string | null;
  last_error_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  run_at: string | null;
  finished_at: string | null;
  created_by: number | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Backoff base (ms) aplicado à 1ª tentativa de retry. */
const BASE_BACKOFF_MS = (() => {
  const n = Number(process.env.JOB_BASE_BACKOFF_MS ?? '1000');
  return Number.isFinite(n) && n > 0 ? n : 1000;
})();

/** Teto do backoff (ms). */
const MAX_BACKOFF_MS = (() => {
  const n = Number(process.env.JOB_MAX_BACKOFF_MS ?? '300000');
  return Number.isFinite(n) && n > 0 ? n : 300000;
})();

/** Intervalo do ciclo do worker (poll). */
const POLL_INTERVAL_MS = (() => {
  const n = Number(process.env.JOB_POLL_INTERVAL_MS ?? '2000');
  return Number.isFinite(n) && n > 0 ? n : 2000;
})();

/** Jobs reivindicados por ciclo do worker. */
const BATCH_SIZE = (() => {
  const n = Number(process.env.JOB_BATCH_SIZE ?? '10');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
})();

/** Identificação desta instância (para locked_by em workers distribuídos). */
const WORKER_ID = `${process.pid}-${crypto.randomUUID()}`;

/* ------------------------------------------------------------------ */
/* Handler registry                                                    */
/* ------------------------------------------------------------------ */

const handlers = new Map<string, JobHandler>();

/**
 * Registra um handler para um tipo de job.
 * Um job sem handler registrado é marcado como 'failed' com erro descritivo.
 */
export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function getRegisteredJobTypes(): string[] {
  return Array.from(handlers.keys());
}

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

/**
 * Enfileira um job. Retorna o id criado.
 * Auditoria: registra 'job:enqueued' em audit_logs.
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<number> {
  const result = await run(
    `INSERT INTO background_jobs
       (queue, type, payload, max_attempts, next_run_at, created_by, tenant_id)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.queue ?? 'default',
      input.type,
      JSON.stringify(input.payload ?? {}),
      input.maxAttempts ?? 3,
      (input.runAt ?? new Date()).toISOString(),
      input.createdBy ?? null,
      input.tenantId ?? 1,
    ]
  );
  const id = result.rows[0].id as number;

  void logAudit({
    entity_type: 'background_job',
    entity_id: String(id),
    action: 'job:enqueued',
    user_id: input.createdBy,
    details: {
      type: input.type,
      queue: input.queue ?? 'default',
      maxAttempts: input.maxAttempts ?? 3,
    },
  });

  logger.debug('jobQueue: job enqueued', { jobId: id, type: input.type, queue: input.queue ?? 'default' });
  return id;
}

/* ------------------------------------------------------------------ */
/* Claim (distributed-safe)                                            */
/* ------------------------------------------------------------------ */

/**
 * Reivindica jobs vencidos para esta instância.
 * Usa FOR UPDATE SKIP LOCKED para que múltiplos workers não processem o mesmo job.
 * Incrementa attempts no momento do claim (execução em curso).
 */
async function claimDueJobs(limit: number): Promise<BackgroundJob[]> {
  const result = await pool.query<BackgroundJob>(
    `WITH candidate AS (
       SELECT id
       FROM background_jobs
       WHERE status IN ('pending', 'retrying') AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE background_jobs b
     SET status = 'running',
         attempts = attempts + 1,
         locked_by = $2,
         locked_at = NOW(),
         run_at = NOW(),
         updated_at = NOW()
     FROM candidate c
     WHERE b.id = c.id
     RETURNING b.*`,
    [limit, WORKER_ID]
  );
  return result.rows;
}

/* ------------------------------------------------------------------ */
/* Processing                                                          */
/* ------------------------------------------------------------------ */

function computeBackoffMs(attempt: number): number {
  const capped = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  // Full jitter: valor aleatório em [0, capped] reduz rajadas de retry.
  return Math.floor(Math.random() * capped);
}

async function processJob(job: BackgroundJob): Promise<void> {
  const ctx: JobContext = {
    jobId: job.id,
    type: job.type,
    queue: job.queue,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
  };
  const handler = handlers.get(job.type);

  if (!handler) {
    await finalizeJob(job, 'failed', `Nenhum handler registrado para o tipo '${job.type}'`);
    return;
  }

  try {
    await handler(job.payload ?? {}, ctx);
    await finalizeJob(job, 'succeeded', null);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (job.attempts >= job.max_attempts) {
      await finalizeJob(job, 'failed', errorMsg);
    } else {
      await finalizeJob(job, 'retrying', errorMsg);
    }
  }
}

async function finalizeJob(job: BackgroundJob, status: 'succeeded' | 'failed' | 'retrying', error: string | null): Promise<void> {
  const nextRunAt = status === 'retrying'
    ? new Date(Date.now() + computeBackoffMs(job.attempts)).toISOString()
    : null;

  await run(
    `UPDATE background_jobs
     SET status = $1,
         next_run_at = COALESCE($2::timestamptz, next_run_at),
         last_error = $3::text,
         last_error_at = CASE WHEN $3::text IS NULL THEN NULL ELSE NOW() END,
         finished_at = CASE WHEN $1 IN ('succeeded', 'failed') THEN NOW() ELSE NULL END,
         locked_by = NULL,
         locked_at = NULL,
         updated_at = NOW()
     WHERE id = $4`,
    [status, nextRunAt, error, job.id]
  );

  const action = status === 'succeeded' ? 'job:succeeded' : status === 'failed' ? 'job:failed' : 'job:retrying';

  void logAudit({
    entity_type: 'background_job',
    entity_id: String(job.id),
    action,
    details: {
      type: job.type,
      queue: job.queue,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      error,
    },
  });

  if (status === 'succeeded') recordJobCompleted();
  else if (status === 'failed') recordJobFailed();
  else recordJobRetried();

  if (status === 'failed') {
    logger.error('jobQueue: job failed', {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      error,
    });
  } else if (status === 'retrying') {
    logger.warn('jobQueue: job retrying', {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
      nextRunAt,
      error,
    });
  } else {
    logger.debug('jobQueue: job succeeded', { jobId: job.id, type: job.type, attempts: job.attempts });
  }
}

/* ------------------------------------------------------------------ */
/* Worker loop                                                         */
/* ------------------------------------------------------------------ */

let timerRef: ReturnType<typeof setInterval> | null = null;
let workerRunning = false;

async function refreshQueueCounts(): Promise<void> {
  try {
    const row = await run(
      `SELECT
         (SELECT COUNT(*)::int FROM background_jobs WHERE status IN ('pending', 'retrying')) AS pending,
         (SELECT COUNT(*)::int FROM background_jobs WHERE status = 'running') AS running,
         (SELECT COUNT(*)::int FROM background_jobs WHERE status = 'retrying') AS retrying`
    );
    const r = row.rows[0] ?? { pending: 0, running: 0, retrying: 0 };
    recordJobQueueCounts({
      pending: Number(r.pending ?? 0),
      running: Number(r.running ?? 0),
      retrying: Number(r.retrying ?? 0),
    });
  } catch (err) {
    recordJobQueueError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Executa um ciclo do worker: reivindica jobs vencidos, processa e sincroniza
 * métricas. Retorna quantos jobs foram processados.
 */
export async function processDueJobs(limit: number = BATCH_SIZE): Promise<number> {
  if (workerRunning) return 0;
  workerRunning = true;
  const startedAt = Date.now();

  try {
    const jobs = await claimDueJobs(limit);
    if (jobs.length === 0) return 0;

    for (const job of jobs) {
      await processJob(job);
    }

    await refreshQueueCounts();
    recordJobQueueRun(Date.now() - startedAt);
    return jobs.length;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('jobQueue: cycle failed', { error: errorMsg });
    recordJobQueueError(errorMsg);
    return 0;
  } finally {
    workerRunning = false;
  }
}

/**
 * Inicia o worker de fila em loop (polling).
 * Não cria timer em NODE_ENV=test (padrão dos demais schedulers).
 */
export function startJobWorker(intervalMs?: number): void {
  if (timerRef !== null) return;
  if (process.env.NODE_ENV === 'test') return;

  const ms = intervalMs ?? POLL_INTERVAL_MS;
  logger.info('Job queue worker started', { intervalMs: ms, batchSize: BATCH_SIZE, workerId: WORKER_ID });

  void refreshQueueCounts();
  timerRef = setInterval(() => {
    void processDueJobs();
  }, ms);
}

export function stopJobWorker(): void {
  if (timerRef === null) return;
  clearInterval(timerRef);
  timerRef = null;
  logger.debug('Job queue worker stopped');
}

export default {
  enqueueJob,
  registerJobHandler,
  getRegisteredJobTypes,
  processDueJobs,
  startJobWorker,
  stopJobWorker,
};

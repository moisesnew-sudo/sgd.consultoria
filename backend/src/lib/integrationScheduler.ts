/**
 * Fase E1.2 — Scheduler de Sincronização Periódica de Integrações Governamentais.
 *
 * Executa sincronização pull periódica com sistemas governamentais externos
 * (Transferegov, SEI, CGLOG) utilizando os GovernmentAdapters da Fase E1.1.
 *
 * Proteção multi-instância: pg_advisory_lock (chave 738291046 — exclusiva
 * para este scheduler, distinta do alertScheduler).
 *
 * Configuração por sistema: integration_systems.config JSONB com campos:
 *   - syncEnabled: boolean (padrão: false)
 *   - syncIntervalMinutes: number (padrão: 60)
 *   - maxRecordsPerSync: number (padrão: 100)
 *
 * Não criar timer se NODE_ENV=test.
 */

import { pool, get, all, run } from '../database.js';
import { getGovAdapter } from './adapterRegistry.js';
import { findDemandByProposalNumber, type SyncResult } from './integrationSync.js';
import { getMappedStatus } from './statusMapping.js';
import { publishEvent, emitIntegrationEvent } from './eventBus.js';
import { logger } from './logger.js';
import { createHash } from 'crypto';
import type { AdapterConfig, SyncPullResult, NormalizedIntegrationEvent } from '../integrations/types.js';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Chave advisory lock exclusiva para este scheduler (int32). */
const SYNC_LOCK_KEY = 738291046;

/** Intervalo de verificação: 1 minuto (o scheduler decide por sistema se é hora de sync). */
const DEFAULT_CHECK_INTERVAL_MS = 60_000;

/** Número de erros consecutivos antes de criar alerta. */
const ALERT_THRESHOLD = 3;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SyncSchedulerStatus = 'idle' | 'running' | 'success' | 'failed';

export interface SystemSyncConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxRecords: number;
}

export interface SyncRunResult {
  systemCode: string;
  status: SyncSchedulerStatus;
  fetchedCount: number;
  normalizedCount: number;
  syncedCount: number;
  duplicateCount: number;
  unmatchedCount: number;
  durationMs: number;
  error?: string;
  httpStatus?: number | null;
  authError?: boolean;
}

export interface SyncSchedulerSummary {
  timestamp: string;
  durationMs: number;
  systemsEvaluated: number;
  systemsSynced: number;
  totalFetched: number;
  totalSynced: number;
  totalDuplicates: number;
  errors: number;
}

/* ------------------------------------------------------------------ */
/* Module state                                                        */
/* ------------------------------------------------------------------ */

let timerRef: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Estado por sistema (para controle de intervalo). */
const lastSyncBySystem = new Map<string, number>();

/** Erros consecutivos por sistema (para alertas). */
const consecutiveErrorsBySystem = new Map<string, number>();

/* ------------------------------------------------------------------ */
/* Scheduler lifecycle                                                 */
/* ------------------------------------------------------------------ */

export function startIntegrationScheduler(intervalMs?: number): void {
  if (timerRef !== null) return;

  const ms = intervalMs ?? parseCheckInterval();
  logger.info('Integration sync scheduler started', {
    intervalMs: ms,
    intervalMin: +(ms / 60_000).toFixed(1),
    pid: process.pid,
  });

  timerRef = setInterval(() => {
    void runScheduledSyncCycle();
  }, ms);
}

export function stopIntegrationScheduler(): void {
  if (timerRef === null) return;
  clearInterval(timerRef);
  timerRef = null;
  logger.debug('Integration sync scheduler stopped');
}

/* ------------------------------------------------------------------ */
/* Main sync cycle                                                     */
/* ------------------------------------------------------------------ */

/**
 * Executa um ciclo de sincronização: seleciona sistemas ativos com sync
 * habilitado, e para cada um verifica se é hora de sincronizar.
 *
 * Utiliza pg_advisory_lock para garantir execução única em ambientes
 * multi-instância.
 */
export async function runScheduledSyncCycle(): Promise<SyncSchedulerSummary | null> {
  if (running) {
    logger.debug('Integration sync cycle skipped: previous cycle still running');
    return null;
  }

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
      [SYNC_LOCK_KEY]
    );
    lockAcquired = lockResult.rows[0].pg_try_advisory_lock;

    if (!lockAcquired) {
      logger.debug('Integration sync skipped: another instance holds the lock');
      return null;
    }

    running = true;
    const startedAt = Date.now();

    logger.info('Integration sync cycle started');

    const systems = await loadActiveSyncSystems();
    const now = Date.now();
    const results: SyncRunResult[] = [];

    for (const system of systems) {
      const config = parseSystemSyncConfig(system.config);
      if (!config.enabled) continue;

      const lastSync = lastSyncBySystem.get(system.code) ?? 0;
      const intervalMs = config.intervalMinutes * 60_000;

      if (now - lastSync < intervalMs) continue;

      const result = await syncSingleSystem(system, config);
      results.push(result);
      lastSyncBySystem.set(system.code, Date.now());
    }

    const totalDuration = Date.now() - startedAt;
    const summary = buildSummary(results, totalDuration);

    logger.info('Integration sync cycle completed', {
      durationMs: totalDuration,
      systemsEvaluated: summary.systemsEvaluated,
      systemsSynced: summary.systemsSynced,
      totalFetched: summary.totalFetched,
      totalSynced: summary.totalSynced,
      totalDuplicates: summary.totalDuplicates,
      errors: summary.errors,
    });

    return summary;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Integration sync cycle failed', { error: errorMsg });
    return null;
  } finally {
    running = false;
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]);
      } catch {
        // unlock failure is non-fatal
      }
    }
    client.release();
  }
}

/* ------------------------------------------------------------------ */
/* Single system sync                                                  */
/* ------------------------------------------------------------------ */

async function syncSingleSystem(
  system: { id: number; code: string; config: Record<string, unknown> | null },
  syncConfig: SystemSyncConfig
): Promise<SyncRunResult> {
  const startedAt = Date.now();
  const result: SyncRunResult = {
    systemCode: system.code,
    status: 'running',
    fetchedCount: 0,
    normalizedCount: 0,
    syncedCount: 0,
    duplicateCount: 0,
    unmatchedCount: 0,
    durationMs: 0,
  };

  try {
    const govAdapter = getGovAdapter(system.code);
    if (!govAdapter) {
      result.status = 'failed';
      result.error = `Nenhum adapter governamental registrado para ${system.code}`;
      result.durationMs = Date.now() - startedAt;
      await recordSyncFailure(system, result);
      return result;
    }

    const adapterConfig: AdapterConfig = {
      baseUrl: system.config?.baseUrl as string | undefined,
      secretEnvKey: system.config?.secretEnvKey as string | undefined,
      timeoutMs: system.config?.timeoutMs as number | undefined,
      maxRetries: system.config?.maxRetries as number | undefined,
      retryBaseDelayMs: system.config?.retryBaseDelayMs as number | undefined,
      extra: system.config?.extra as Record<string, unknown> | undefined,
    };

    const syncResult = await govAdapter.sync(adapterConfig, {
      maxRecords: syncConfig.maxRecords,
    });

    result.fetchedCount = syncResult.fetchedCount;
    result.normalizedCount = syncResult.normalizedCount;
    result.httpStatus = syncResult.httpStatus;
    result.authError = syncResult.authError;

    if (!syncResult.success) {
      result.status = 'failed';
      result.error = syncResult.error;
      result.durationMs = Date.now() - startedAt;
      await recordSyncFailure(system, result);
      return result;
    }

    // Processar eventos normalizados
    for (const event of syncResult.events) {
      const processed = await processSyncEvent(system.id, system.code, event);
      if (processed === 'synced') result.syncedCount++;
      else if (processed === 'duplicate') result.duplicateCount++;
      else result.unmatchedCount++;
    }

    result.status = 'success';
    result.durationMs = Date.now() - startedAt;

    // Limpar erros consecutivos em caso de sucesso
    consecutiveErrorsBySystem.set(system.code, 0);

    await recordSyncSuccess(system, result);

    return result;
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    result.durationMs = Date.now() - startedAt;
    await recordSyncFailure(system, result);
    return result;
  }
}

/* ------------------------------------------------------------------ */
/* Event processing                                                    */
/* ------------------------------------------------------------------ */

type ProcessResult = 'synced' | 'duplicate' | 'unmatched';

/**
 * Processa um evento normalizado: valida, deduplica, aplica status mapping
 * e persiste se houver alteração real.
 */
async function processSyncEvent(
  systemId: number,
  systemCode: string,
  event: NormalizedIntegrationEvent
): Promise<ProcessResult> {
  try {
    // Validação: precisa de proposalNumber para localizar demanda
    if (!event.proposalNumber) {
      return 'unmatched';
    }

    // Verificar se há mapeamento de status
    let internalStatus: string | null = null;
    if (event.externalStatus) {
      const mapping = await getMappedStatus(systemCode, event.externalStatus);
      if (!mapping.found || !mapping.internalStatus) {
        return 'unmatched';
      }
      internalStatus = mapping.internalStatus;
    }

    // Localizar demanda SGD
    const demand = await findDemandByProposalNumber(event.proposalNumber);
    if (!demand) {
      return 'unmatched';
    }

    // Deduplicação: verificar se já existe sincronização idêntica
    const isDuplicate = await checkDuplicate(systemId, demand.id, event);
    if (isDuplicate) {
      return 'duplicate';
    }

    // Aplicar alterações (somente se houver mudança real)
    const hasChanges = internalStatus || event.deadline;
    if (!hasChanges) {
      return 'duplicate'; // Nada mudou
    }

    // Persistir alteração
    await applySyncChanges(demand.id, systemId, systemCode, event, internalStatus);

    return 'synced';
  } catch (error) {
    logger.error('Erro ao processar evento de sincronização', {
      system: systemCode,
      proposalNumber: event.proposalNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'unmatched';
  }
}

/* ------------------------------------------------------------------ */
/* Deduplication                                                       */
/* ------------------------------------------------------------------ */

/**
 * Verifica se a sincronização é uma duplicata.
 * Estratégia: compara external_id + proposal_number + hash do status
 * com o registro existente em demand_integrations.
 */
async function checkDuplicate(
  systemId: number,
  demandId: string,
  event: NormalizedIntegrationEvent
): Promise<boolean> {
  const existing = await get<{
    external_id: string | null;
    proposal_number: string | null;
    sync_status: string;
    data: Record<string, unknown> | null;
  }>(
    `SELECT external_id, proposal_number, sync_status, data
     FROM demand_integrations
     WHERE demand_id = $1 AND system_id = $2`,
    [demandId, systemId]
  );

  if (!existing) return false;

  // Se o status mudou, não é duplicata
  const existingData = existing.data as Record<string, unknown> | null;
  const existingChanges = existingData?.changes as Record<string, unknown> | undefined;
  const existingStatus = existingChanges?.status;
  const newStatus = event.externalStatus;
  if (existingStatus !== newStatus) return false;

  // Se o external_id mudou, não é duplicata
  if (existing.external_id !== (event.externalId ?? null)) return false;

  return true;
}

/* ------------------------------------------------------------------ */
/* Apply changes                                                       */
/* ------------------------------------------------------------------ */

/**
 * Aplica as alterações de sincronização: atualiza demanda, registra
 * timeline, auditoria e vínculo demand_integrations.
 */
async function applySyncChanges(
  demandId: string,
  systemId: number,
  systemCode: string,
  event: NormalizedIntegrationEvent,
  internalStatus: string | null
): Promise<void> {
  const systemLabel = systemCode.toUpperCase();

  // Buscar status atual da demanda
  const demand = await get<{ status: string }>(
    'SELECT status FROM demands WHERE id = $1 AND deleted_at IS NULL',
    [demandId]
  );
  if (!demand) return;

  const previousStatus = demand.status;

  // Atualizar demanda (somente se status mudou)
  if (internalStatus && internalStatus !== previousStatus) {
    await run(
      'UPDATE demands SET status = $1, updated_at = NOW() WHERE id = $2',
      [internalStatus, demandId]
    );
  }

  // Timeline de integração
  const lines = [`Sistema: ${systemLabel} (sync periódica)`];
  const changeLines: string[] = [];
  if (internalStatus && internalStatus !== previousStatus) {
    changeLines.push(`Status: ${previousStatus} → ${internalStatus}`);
  }
  if (event.deadline) changeLines.push(`Prazo: ${event.deadline.slice(0, 10)}`);
  if (changeLines.length > 0) lines.push('Alterações:', ...changeLines);

  // Usar addTimelineEvent do helpers se disponível, senão inserir diretamente
  try {
    const { addTimelineEvent } = await import('./helpers.js');
    await addTimelineEvent(
      demandId,
      'Integração Sincronizada (Periódica)',
      lines.join('\n'),
      systemLabel,
      internalStatus ?? null,
      'integration',
      { system: systemCode, source: 'periodic_sync', proposalNumber: event.proposalNumber }
    );
  } catch {
    // Fallback: inserir timeline diretamente
    await run(
      `INSERT INTO timeline_events (demand_id, title, description, user_name, new_status, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [demandId, 'Integração Sincronizada (Periódica)', lines.join('\n'), systemLabel, internalStatus, 'integration', JSON.stringify({ system: systemCode, source: 'periodic_sync' })]
    );
  }

  // Auditoria
  try {
    const { logAudit } = await import('./audit.js');
    await logAudit({
      entity_type: 'demand',
      entity_id: demandId,
      action: 'integration_sync_periodic',
      user_name: systemLabel,
      details: {
        system: systemCode,
        source: 'periodic_sync',
        demand_id: demandId,
        previousStatus,
        newStatus: internalStatus,
        proposalNumber: event.proposalNumber,
        externalId: event.externalId,
      },
    });
  } catch {
    // Auditoria é best-effort
  }

  // Vínculo demand_integrations (UPSERT)
  await run(
    `INSERT INTO demand_integrations (demand_id, system_id, external_id, proposal_number, last_sync_at, sync_status, data)
     VALUES ($1, $2, $3, $4, NOW(), 'synced', $5)
     ON CONFLICT (demand_id, system_id) DO UPDATE SET
       external_id = EXCLUDED.external_id,
       proposal_number = EXCLUDED.proposal_number,
       last_sync_at = NOW(),
       sync_status = 'synced',
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [
      demandId,
      systemId,
      event.externalId ?? null,
      event.proposalNumber ?? null,
      JSON.stringify({
        source: 'periodic_sync',
        event_type: event.eventType,
        changes: { status: internalStatus },
      }),
    ]
  );

  // Publicar eventos no Event Bus
  if (internalStatus && internalStatus !== previousStatus) {
    await publishEvent('demand:status_changed', {
      demandId,
      title: `Status alterado via ${systemLabel}`,
      from: previousStatus,
      to: internalStatus,
    });
  }

  await emitIntegrationEvent('integration:synced', {
    systemId,
    status: 'success',
    durationMs: 0,
  });
}

/* ------------------------------------------------------------------ */
/* Metrics recording                                                   */
/* ------------------------------------------------------------------ */

async function recordSyncSuccess(
  system: { id: number; code: string },
  result: SyncRunResult
): Promise<void> {
  await run(
    `UPDATE integration_systems SET
       last_sync_at = NOW(),
       last_http_status = 200,
       last_response_ms = $2,
       consecutive_errors = 0,
       last_error_at = NULL,
       last_error_message = NULL,
       updated_at = NOW()
     WHERE id = $1`,
    [system.id, result.durationMs]
  );

  await run(
    `INSERT INTO integration_logs (system_id, system_code, direction, action, status, message, duration_ms, http_status, triggered_by)
     VALUES ($1, $2, 'out', 'integration.sync.periodic', 'success', $3, $4, 200, 'scheduler')`,
    [
      system.id,
      system.code,
      `Sync periódica: ${result.fetchedCount} obtidos, ${result.syncedCount} sincronizados, ${result.duplicateCount} duplicatas`,
      result.durationMs,
    ]
  );
}

async function recordSyncFailure(
  system: { id: number; code: string },
  result: SyncRunResult
): Promise<void> {
  const errors = (consecutiveErrorsBySystem.get(system.code) ?? 0) + 1;
  consecutiveErrorsBySystem.set(system.code, errors);

  const httpStatus = result.httpStatus ?? null;

  await run(
    `UPDATE integration_systems SET
       last_sync_at = NOW(),
       last_error_at = NOW(),
       last_error_message = $2,
       last_http_status = $3,
       last_response_ms = $4,
       consecutive_errors = $5,
       updated_at = NOW()
     WHERE id = $1`,
    [system.id, result.error ?? 'Erro desconhecido', httpStatus, result.durationMs, errors]
  );

  await run(
    `INSERT INTO integration_logs (system_id, system_code, direction, action, status, message, duration_ms, http_status, triggered_by, error_message)
     VALUES ($1, $2, 'out', 'integration.sync.periodic', 'error', $3, $4, $5, 'scheduler', $6)`,
    [
      system.id,
      system.code,
      `Sync periódica falhou: ${result.error}`,
      result.durationMs,
      httpStatus,
      result.error,
    ]
  );

  // Atualizar error_count_24h
  await run(
    `UPDATE integration_systems SET error_count_24h = (
       SELECT COUNT(*) FROM integration_logs
       WHERE system_id = $1 AND status = 'error' AND created_at > NOW() - INTERVAL '24 hours'
     ) WHERE id = $1`,
    [system.id]
  );

  // Alerta para falhas persistentes
  if (errors >= ALERT_THRESHOLD) {
    logger.warn('Falha persistente na sincronização periódica', {
      system: system.code,
      consecutiveErrors: errors,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface SystemRow {
  id: number;
  code: string;
  config: Record<string, unknown> | null;
}

async function loadActiveSyncSystems(): Promise<SystemRow[]> {
  const rows = await all<SystemRow>(
    `SELECT id, code, config
     FROM integration_systems
     WHERE active = TRUE`
  );
  return rows;
}

function parseSystemSyncConfig(config: unknown): SystemSyncConfig {
  if (!config || typeof config !== 'object') {
    return { enabled: false, intervalMinutes: 60, maxRecords: 100 };
  }
  const c = config as Record<string, unknown>;
  return {
    enabled: c.syncEnabled === true,
    intervalMinutes: typeof c.syncIntervalMinutes === 'number' && c.syncIntervalMinutes > 0
      ? c.syncIntervalMinutes
      : 60,
    maxRecords: typeof c.maxRecordsPerSync === 'number' && c.maxRecordsPerSync > 0
      ? c.maxRecordsPerSync
      : 100,
  };
}

function buildSummary(results: SyncRunResult[], durationMs: number): SyncSchedulerSummary {
  return {
    timestamp: new Date().toISOString(),
    durationMs,
    systemsEvaluated: results.length,
    systemsSynced: results.filter((r) => r.status === 'success').length,
    totalFetched: results.reduce((sum, r) => sum + r.fetchedCount, 0),
    totalSynced: results.reduce((sum, r) => sum + r.syncedCount, 0),
    totalDuplicates: results.reduce((sum, r) => sum + r.duplicateCount, 0),
    errors: results.filter((r) => r.status === 'failed').length,
  };
}

function parseCheckInterval(): number {
  const raw = process.env.INTEGRATION_SYNC_INTERVAL_MS;
  if (!raw) return DEFAULT_CHECK_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10_000) return DEFAULT_CHECK_INTERVAL_MS;
  return Math.floor(n);
}

/* ------------------------------------------------------------------ */
/* Exports for testing                                                 */
/* ------------------------------------------------------------------ */

export {
  SYNC_LOCK_KEY,
  DEFAULT_CHECK_INTERVAL_MS,
  ALERT_THRESHOLD,
  lastSyncBySystem,
  consecutiveErrorsBySystem,
  parseSystemSyncConfig,
  loadActiveSyncSystems,
  checkDuplicate,
};

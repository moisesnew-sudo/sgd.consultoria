import { get, run, transaction } from '../database.js';
import { logger } from './logger.js';
import { getAdapter } from './adapterRegistry.js';
import { syncIntegrationEvent, type SyncResult } from './integrationSync.js';
import { addTimelineEvent } from './helpers.js';
import { logAudit } from './audit.js';

/**
 * Processador de eventos de webhook (Fase 2.2.2).
 *
 * Converte um SyncResult em atualizações reais do SGD dentro de uma
 * transação atômica (BEGIN...COMMIT/ROLLBACK):
 *
 * 1. UPDATE demands (somente campos devolvidos em SyncResult.changes);
 * 2. INSERT timeline_events (evento de integração);
 * 3. INSERT audit_logs (action integration_sync);
 * 4. UPSERT demand_integrations (ON CONFLICT demand_id+system_id);
 * 5. INSERT integration_logs (status success);
 * 6. UPDATE webhook_events (processed + processed_at).
 *
 * Idempotente: um evento já 'processed'/'duplicate' retorna already_processed
 * sem reexecutar nada; a guarda concorrente no UPDATE evita corrida dupla.
 */

export interface ProcessWebhookEventResult {
  success: boolean;
  status: 'processed' | 'unmatched' | 'failed';
  reason?: string;
}

export interface ProcessWebhookEventOptions {
  /** Origem da execução — 'webhook' (padrão) ou 'manual' (sincronização administrativa). */
  triggeredBy?: string;
}

interface RunContext {
  startedAt: number;
  triggeredBy: string;
}

interface WebhookEventRow {
  id: number;
  system_id: number;
  system_code: string;
  event_type: string;
  payload: unknown;
  status: string;
}

/** Sinal interno: outro processamento já finalizou o evento (guarda concorrente). */
class AlreadyProcessedError extends Error {}

const TERMINAL_STATUSES = ['processed', 'duplicate'];
const CHANGE_COLUMNS = ['status', 'deadline'] as const;

export async function processWebhookEvent(eventId: number, options?: ProcessWebhookEventOptions): Promise<ProcessWebhookEventResult> {
  const ctx: RunContext = {
    startedAt: Date.now(),
    triggeredBy: options?.triggeredBy || 'webhook',
  };

  const event = await get<WebhookEventRow>('SELECT * FROM webhook_events WHERE id = $1', [eventId]);
  if (!event) {
    logger.warn('Webhook event não encontrado', { eventId });
    return { success: false, status: 'failed', reason: 'event not found' };
  }

  if (TERMINAL_STATUSES.includes(event.status)) {
    logger.info('Webhook event já processado — ignorado', { eventId, status: event.status });
    return { success: true, status: 'processed', reason: 'already_processed' };
  }

  const adapter = getAdapter(event.system_code);
  if (!adapter) {
    await persistFailure(event, 'adapter not found', ctx);
    return { success: false, status: 'failed', reason: 'adapter not found' };
  }

  const result = await syncIntegrationEvent(event.payload, {
    systemCode: event.system_code,
    webhookEventId: eventId,
    source: 'webhook',
  });

  if (result.action === 'synced') {
    try {
      return await persistSynced(event, result, ctx);
    } catch (error) {
      const reason = `persist error: ${error instanceof Error ? error.message : String(error)}`;
      logger.error('Falha na persistência da sincronização (rollback aplicado)', { eventId, error });
      await persistFailure(event, reason, ctx);
      return { success: false, status: 'failed', reason };
    }
  }

  // unmatched | ignored
  await persistUnmatched(event, result.reason || 'sem correspondência', ctx);
  return { success: true, status: 'unmatched', reason: result.reason };
}

/** Caminho de sucesso: atualiza demanda, timeline, auditoria, vínculo e evento — atômico. */
async function persistSynced(event: WebhookEventRow, result: SyncResult, ctx: RunContext): Promise<ProcessWebhookEventResult> {
  return transaction<ProcessWebhookEventResult>(async (client) => {
    // Guarda concorrente: se outro processo já finalizou, aborta sem escrever nada.
    const guarded = await client.query<{ id: number }>(
      `UPDATE webhook_events SET status = 'processed', processed_at = NOW(), error = NULL
       WHERE id = $1 AND status NOT IN ('processed', 'duplicate')
       RETURNING id`,
      [event.id]
    );
    if (!guarded.rows[0]) {
      throw new AlreadyProcessedError();
    }

    const demandId = result.demandId;
    if (!demandId) {
      throw new Error('resultado sincronizado sem demandId');
    }

    const demand = await client.query<{ status: string }>(
      'SELECT status FROM demands WHERE id = $1 AND deleted_at IS NULL',
      [demandId]
    );
    if (!demand.rows[0]) {
      throw new Error('demanda não encontrada na persistência');
    }
    const previousStatus = demand.rows[0].status;

    const changes = result.changes ?? {};
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const column of CHANGE_COLUMNS) {
      if (changes[column] !== undefined) {
        sets.push(`${column} = $${idx++}`);
        params.push(changes[column]);
      }
    }

    // 1. UPDATE demands — somente os campos devolvidos em changes; nunca sobrescreve o resto.
    if (sets.length > 0) {
      sets.push('updated_at = NOW()');
      params.push(demandId);
      await client.query(`UPDATE demands SET ${sets.join(', ')} WHERE id = $${idx}`, params);
    }

    // 2. Timeline de integração.
    const systemLabel = event.system_code.toUpperCase();
    const lines = [`Sistema: ${systemLabel}`];
    const changeLines: string[] = [];
    if (changes.status) changeLines.push(`Status: ${previousStatus} → ${changes.status}`);
    if (changes.deadline) changeLines.push(`Prazo: ${changes.deadline.slice(0, 10)}`);
    if (changeLines.length > 0) lines.push('Alterações:', ...changeLines);

    await addTimelineEvent(
      demandId,
      'Integração Sincronizada',
      lines.join('\n'),
      systemLabel,
      changes.status ?? null,
      'integration',
      { system: event.system_code, webhook_event_id: event.id, changes },
      client
    );

    // 3. Auditoria (best-effort, mesmo padrão dos demais fluxos).
    await logAudit(
      {
        entity_type: 'demand',
        entity_id: demandId,
        action: 'integration_sync',
        user_name: systemLabel,
        details: {
          system: event.system_code,
          webhook_event_id: event.id,
          demand_id: demandId,
          changes,
        },
      },
      client
    );

    // 4. Vínculo demanda × sistema (UPSERT — nunca duplica).
    await client.query(
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
        event.system_id,
        result.metadata?.externalId ?? null,
        result.metadata?.proposalNumber ?? null,
        JSON.stringify({
          changes,
          event_type: result.metadata?.eventType ?? event.event_type,
        }),
      ]
    );

    // 5. Log de integração (success) — instrumentado com os campos de execução da Fase 3.1.
    const durationMs = Date.now() - ctx.startedAt;
    const successMessage = `Sincronização concluída para a demanda ${demandId}`;
    await client.query(
      `INSERT INTO integration_logs (system_id, system_code, direction, action, demand_id, webhook_event_id, status, message, duration_ms, http_status, response_summary, triggered_by, error_message)
       VALUES ($1, $2, 'in', 'integration.sync', $3, $4, 'success', $5, $6, NULL, $5, $7, NULL)`,
      [event.system_id, event.system_code, demandId, event.id, successMessage, durationMs, ctx.triggeredBy]
    );

    logger.info('Webhook event processado com sucesso', { eventId: event.id, demandId, changes });
    return { success: true, status: 'processed' };
  }).catch((error) => {
    if (error instanceof AlreadyProcessedError) {
      return { success: true, status: 'processed', reason: 'already_processed' };
    }
    throw error;
  });
}

/** Sem correspondência (status desconhecido ou demanda inexistente): warning + evento unmatched. */
async function persistUnmatched(event: WebhookEventRow, reason: string, ctx: RunContext): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `UPDATE webhook_events SET status = 'unmatched', processed_at = NOW(), error = $2
       WHERE id = $1 AND status NOT IN ('processed', 'duplicate')`,
      [event.id, reason]
    );
    const durationMs = Date.now() - ctx.startedAt;
    const message = `Evento sem correspondência no SGD: ${reason}`;
    await client.query(
      `INSERT INTO integration_logs (system_id, system_code, direction, action, webhook_event_id, status, message, duration_ms, http_status, response_summary, triggered_by, error_message)
       VALUES ($1, $2, 'in', 'integration.sync', $3, 'warning', $4, $5, NULL, $4, $6, NULL)`,
      [event.system_id, event.system_code, event.id, message, durationMs, ctx.triggeredBy]
    );
  });
  logger.warn('Webhook event sem correspondência', { eventId: event.id, reason });
}

/** Falha: log error + evento failed (gravação pós-rollback via pool, sempre executada). */
async function persistFailure(event: WebhookEventRow, reason: string, ctx: RunContext): Promise<void> {
  try {
    await transaction(async (client) => {
      await client.query(
        `UPDATE webhook_events SET status = 'failed', processed_at = NOW(), error = $2 WHERE id = $1`,
        [event.id, reason]
      );
      const durationMs = Date.now() - ctx.startedAt;
      const message = `Falha na sincronização: ${reason}`;
      await client.query(
        `INSERT INTO integration_logs (system_id, system_code, direction, action, webhook_event_id, status, message, duration_ms, http_status, response_summary, triggered_by, error_message)
         VALUES ($1, $2, 'in', 'integration.sync', $3, 'error', $4, $5, NULL, NULL, $6, $7)`,
        [event.system_id, event.system_code, event.id, message, durationMs, ctx.triggeredBy, reason]
      );
    });
  } catch (error) {
    logger.error('Falha ao registrar erro do webhook event', { eventId: event.id, error });
  }
}

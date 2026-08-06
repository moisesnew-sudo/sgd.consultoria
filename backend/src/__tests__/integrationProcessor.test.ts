import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { run, get, all } from '../database.js';
import { processWebhookEvent } from '../lib/integrationProcessor.js';
import { addTimelineEvent } from '../lib/helpers.js';

vi.mock('../lib/helpers.js', { spy: true });

let systemId: number;
let demandId: string;

async function insertEvent(payload: unknown, status = 'pending'): Promise<number> {
  const res = await run(
    `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      systemId,
      'transferegov',
      'demand.updated',
      `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      JSON.stringify(payload),
      status,
    ]
  );
  return res.rows[0].id as number;
}

beforeAll(async () => {
  const system = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', ['transferegov']);
  if (!system) throw new Error('Sistema transferegov não seedado');
  systemId = system.id;

  const res = await run(
    `INSERT INTO demands (id, title, category, municipality, uf, status, priority, proposal_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [`SYNC-PROC-${Date.now()}`, 'DEMANDA PROCESSOR', 'INTEGRACAO', 'FORTALEZA', 'CE', 'pendente', 'media', 'PROP-PROC-001']
  );
  demandId = res.rows[0].id as string;
});

afterAll(async () => {
  const events = await all<{ id: number }>("SELECT id FROM webhook_events WHERE idempotency_key LIKE 'test-%'");
  const ids = events.map(e => e.id);
  if (ids.length > 0) {
    await run('DELETE FROM integration_logs WHERE webhook_event_id = ANY($1::int[])', [ids]);
    await run('DELETE FROM webhook_events WHERE id = ANY($1::int[])', [ids]);
  }
  await run("DELETE FROM audit_logs WHERE action = 'integration_sync' AND entity_id = $1", [demandId]);
  await run('DELETE FROM demands WHERE id = $1', [demandId]);
});

describe('Webhook Event Processor (Fase 2.2.2)', () => {
  it('evento Transferegov válido — atualiza status e deadline, marca processed', async () => {
    const eventId = await insertEvent({
      proposal_number: 'PROP-PROC-001',
      status: 'APROVADO',
      deadline: '2026-12-31',
    });

    const result = await processWebhookEvent(eventId);
    expect(result).toEqual({ success: true, status: 'processed' });

    const demand = await get<{ status: string; deadline: Date }>('SELECT status, deadline FROM demands WHERE id = $1', [demandId]);
    expect(demand?.status).toBe('concluido');
    expect(demand?.deadline.toISOString()).toBe('2026-12-31T00:00:00.000Z');

    const event = await get<{ status: string; processed_at: Date }>('SELECT status, processed_at FROM webhook_events WHERE id = $1', [eventId]);
    expect(event?.status).toBe('processed');
    expect(event?.processed_at).toBeTruthy();

    const timeline = await all('SELECT * FROM timeline_events WHERE demand_id = $1', [demandId]);
    expect(timeline.length).toBe(1);
    expect(timeline[0].title).toBe('Integração Sincronizada');
    expect(timeline[0].details).toMatchObject({ webhook_event_id: eventId });

    const link = await get('SELECT * FROM demand_integrations WHERE demand_id = $1 AND system_id = $2', [demandId, systemId]);
    expect(link).toBeTruthy();
    expect(link.sync_status).toBe('synced');
    expect(link.proposal_number).toBe('PROP-PROC-001');
  });

  it('status externo desconhecido — unmatched, demanda inalterada', async () => {
    const eventId = await insertEvent({ proposal_number: 'PROP-PROC-001', status: 'DESCONHECIDO' });

    const result = await processWebhookEvent(eventId);
    expect(result).toEqual({ success: true, status: 'unmatched', reason: 'Unknown external status' });

    const demand = await get<{ status: string }>('SELECT status FROM demands WHERE id = $1', [demandId]);
    expect(demand?.status).toBe('concluido');

    const event = await get<{ status: string }>('SELECT status FROM webhook_events WHERE id = $1', [eventId]);
    expect(event?.status).toBe('unmatched');

    const logs = await all('SELECT * FROM integration_logs WHERE webhook_event_id = $1', [eventId]);
    expect(logs.some(l => l.status === 'warning')).toBe(true);
  });

  it('demanda não encontrada — unmatched + log criado', async () => {
    const eventId = await insertEvent({ proposal_number: 'PROP-INEXISTENTE-999', status: 'APROVADO' });

    const result = await processWebhookEvent(eventId);
    expect(result).toEqual({ success: true, status: 'unmatched', reason: 'demand not found' });

    const event = await get<{ status: string }>('SELECT status FROM webhook_events WHERE id = $1', [eventId]);
    expect(event?.status).toBe('unmatched');

    const logs = await all('SELECT * FROM integration_logs WHERE webhook_event_id = $1', [eventId]);
    expect(logs.some(l => l.status === 'warning')).toBe(true);
  });

  it('processamento duplicado — already_processed sem duplicar timeline/audit/vínculo', async () => {
    const eventId = await insertEvent({ proposal_number: 'PROP-PROC-001', status: 'APROVADO' });

    const first = await processWebhookEvent(eventId);
    expect(first).toEqual({ success: true, status: 'processed' });

    const second = await processWebhookEvent(eventId);
    expect(second).toEqual({ success: true, status: 'processed', reason: 'already_processed' });

    const timelineCount = await get<{ c: string }>(
      `SELECT COUNT(*) as c FROM timeline_events
       WHERE demand_id = $1 AND details->>'webhook_event_id' = $2`,
      [demandId, String(eventId)]
    );
    expect(Number(timelineCount?.c)).toBe(1);

    const auditCount = await get<{ c: string }>(
      `SELECT COUNT(*) as c FROM audit_logs
       WHERE action = 'integration_sync' AND entity_id = $1 AND details->>'webhook_event_id' = $2`,
      [demandId, String(eventId)]
    );
    expect(Number(auditCount?.c)).toBe(1);

    const linkCount = await get<{ c: string }>('SELECT COUNT(*) as c FROM demand_integrations WHERE demand_id = $1', [demandId]);
    expect(Number(linkCount?.c)).toBe(1);
  });

  it('falha na persistência — rollback real, nenhum dado parcial', async () => {
    const eventId = await insertEvent({
      proposal_number: 'PROP-PROC-001',
      status: 'APROVADO',
      deadline: '2027-01-15',
    });

    const spy = vi.mocked(addTimelineEvent);
    spy.mockImplementationOnce(async () => {
      throw new Error('falha simulada no timeline');
    });

    const result = await processWebhookEvent(eventId);
    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');

    const demand = await get<{ status: string; deadline: Date }>('SELECT status, deadline FROM demands WHERE id = $1', [demandId]);
    expect(demand?.status).toBe('concluido');
    expect(demand?.deadline.toISOString()).toBe('2026-12-31T00:00:00.000Z');

    const timelineCount = await get<{ c: string }>(
      `SELECT COUNT(*) as c FROM timeline_events
       WHERE demand_id = $1 AND details->>'webhook_event_id' = $2`,
      [demandId, String(eventId)]
    );
    expect(Number(timelineCount?.c)).toBe(0);

    const link = await get<{ data: any }>('SELECT data FROM demand_integrations WHERE demand_id = $1 AND system_id = $2', [demandId, systemId]);
    expect(link?.data?.changes?.status).toBe('concluido');

    const event = await get<{ status: string; error: string }>('SELECT status, error FROM webhook_events WHERE id = $1', [eventId]);
    expect(event?.status).toBe('failed');
    expect(event?.error).toContain('falha simulada');
  });
});

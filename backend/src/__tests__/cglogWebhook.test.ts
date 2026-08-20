import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import app from '../server.js';
import { run, get, all } from '../database.js';

const SECRET = process.env.CGLOG_WEBHOOK_SECRET || 'test-cglog-secret';
const SYSTEM_CODE = 'cglog';
const INACTIVE_CODE = 'cgloginativo';

const DEMAND_1_ID = 'cglog-webhook-test-001';
const DEMAND_2_ID = 'cglog-webhook-test-002';
const PROPOSAL_1 = 'PROP-CGLOG-WEBHOOK-001';
const PROPOSAL_2 = 'PROP-CGLOG-WEBHOOK-002';

function sign(body: string, secret: string, timestamp: number, idempotencyKey?: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}\n`);
  if (idempotencyKey) hmac.update(`${idempotencyKey}\n`);
  hmac.update(body, 'utf8');
  return hmac.digest('hex');
}

function payloadFor(proposal: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: 'demand.updated',
    protocolo: `CGLOG-WB-${proposal}`,
    proposta: proposal,
    status: 'EM_ANALISE',
    prazo: '2026-12-31',
    ...overrides,
  };
}

async function sendWebhook(body: string, overrides: {
  system?: string;
  timestamp?: number;
  signature?: string;
  idempotencyKey?: string;
} = {}) {
  const system = overrides.system ?? SYSTEM_CODE;
  const timestamp = overrides.timestamp ?? Date.now();
  const signature = overrides.signature ?? sign(body, SECRET, timestamp, overrides.idempotencyKey);
  const req = request(app)
    .post(`/api/integrations/webhooks/${system}`)
    .set('Content-Type', 'application/json')
    .set('X-Timestamp', String(timestamp))
    .set('X-Signature', signature);
  if (overrides.idempotencyKey) req.set('X-Idempotency-Key', overrides.idempotencyKey);
  return req.send(body);
}

async function seedDemand(id: string, proposal: string) {
  await run(
    `INSERT INTO demands (id, title, category, status, municipality, uf, proposal_number)
     VALUES ($1, $2, $3, 'pendente', 'São Paulo', 'SP', $4)
     ON CONFLICT (id) DO UPDATE SET proposal_number = EXCLUDED.proposal_number, status = 'pendente', deadline = NULL`,
    [id, `Demanda teste webhook CGLOG ${proposal}`, 'infraestrutura', proposal]
  );
}

let systemId = 0;
const createdEventIds: number[] = [];

beforeAll(async () => {
  process.env.CGLOG_WEBHOOK_SECRET = SECRET;

  const system = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', [SYSTEM_CODE]);
  if (!system) {
    await run(
      "INSERT INTO integration_systems (code, name, secret_env_key) VALUES ($1, 'CGLOG', $2)",
      [SYSTEM_CODE, 'CGLOG_WEBHOOK_SECRET']
    );
    systemId = (await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', [SYSTEM_CODE]))!.id;
  } else {
    systemId = system.id;
  }

  await run('DELETE FROM integration_systems WHERE code = $1', [INACTIVE_CODE]);
  await run(
    "INSERT INTO integration_systems (code, name, secret_env_key, active) VALUES ($1, 'CGLOG Inativo', $2, FALSE)",
    [INACTIVE_CODE, 'CGLOG_WEBHOOK_SECRET']
  );

  await run('DELETE FROM demands WHERE id LIKE $1', ['cglog-webhook-test-%']);
  await run('DELETE FROM webhook_events WHERE system_id = $1 AND idempotency_key LIKE $2', [systemId, 'cglog:%']);
  await seedDemand(DEMAND_1_ID, PROPOSAL_1);
  await seedDemand(DEMAND_2_ID, PROPOSAL_2);
});

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await run('DELETE FROM integration_logs WHERE webhook_event_id = ANY($1::int[])', [createdEventIds]);
    await run('DELETE FROM webhook_events WHERE id = ANY($1::int[])', [createdEventIds]);
  }
  await run('DELETE FROM demand_integrations WHERE demand_id LIKE $1', ['cglog-webhook-test-%']);
  await run('DELETE FROM audit_logs WHERE entity_type = $1 AND entity_id LIKE $2 AND action = $3', [
    'demand', 'cglog-webhook-test-%', 'integration_sync',
  ]);
  await run('DELETE FROM demands WHERE id LIKE $1', ['cglog-webhook-test-%']);
  await run('DELETE FROM integration_systems WHERE code = $1', [INACTIVE_CODE]);
});

describe('CGLOG — webhook-driven (contrato de consulta não confirmado)', () => {
  it('1. aceita evento válido, processa e sincroniza a demanda (EM_ANALISE → analise)', async () => {
    const body = JSON.stringify(payloadFor(PROPOSAL_1));
    const res = await sendWebhook(body, { idempotencyKey: 'cglog-evt-001' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');
    expect(res.body.duplicate).toBe(false);
    expect(res.body.system).toBe(SYSTEM_CODE);
    expect(res.body.event_id).toBeTypeOf('number');
    createdEventIds.push(res.body.event_id);

    const event = await get<any>('SELECT * FROM webhook_events WHERE id = $1', [res.body.event_id]);
    expect(event).toBeDefined();
    expect(event.system_code).toBe(SYSTEM_CODE);
    expect(event.event_type).toBe('demand.updated');
    expect(event.status).toBe('processed');
    expect(event.idempotency_key).toBe(`cglog:cglog-evt-001`);
    expect(event.payload.proposta).toBe(PROPOSAL_1);
    expect(event.payload.status).toBe('EM_ANALISE');
    expect(event.headers['x-signature']).toBeTypeOf('string');

    const demand = await get<any>('SELECT * FROM demands WHERE id = $1', [DEMAND_1_ID]);
    expect(demand.status).toBe('analise');
    expect(new Date(demand.deadline).toISOString()).toBe('2026-12-31T00:00:00.000Z');

    const link = await get<any>(
      'SELECT * FROM demand_integrations WHERE demand_id = $1 AND system_id = $2',
      [DEMAND_1_ID, systemId]
    );
    expect(link).toBeDefined();
    expect(link.external_id).toBe(`CGLOG-WB-${PROPOSAL_1}`);
    expect(link.proposal_number).toBe(PROPOSAL_1);
    expect(link.sync_status).toBe('synced');

    const timeline = await get<any>(
      'SELECT * FROM timeline_events WHERE demand_id = $1 ORDER BY created_at DESC LIMIT 1',
      [DEMAND_1_ID]
    );
    expect(timeline).toBeDefined();
    expect(timeline.title).toBe('Integração Sincronizada');
    expect(timeline.status_changed_to).toBe('analise');

    const audit = await get<any>(
      'SELECT * FROM audit_logs WHERE entity_id = $1 AND action = $2 ORDER BY id DESC LIMIT 1',
      [DEMAND_1_ID, 'integration_sync']
    );
    expect(audit).toBeDefined();
    expect(audit.details.system).toBe(SYSTEM_CODE);

    const logs = await all<any>(
      'SELECT * FROM integration_logs WHERE webhook_event_id = $1 ORDER BY id',
      [res.body.event_id]
    );
    const actions = logs.map((l) => l.action);
    expect(actions).toContain('webhook.received');
    expect(actions).toContain('integration.sync');
    const syncLog = logs.find((l) => l.action === 'integration.sync');
    expect(syncLog.status).toBe('success');
    expect(syncLog.direction).toBe('in');
    expect(syncLog.triggered_by).toBe('webhook');
  });

  it('2. idempotência: X-Idempotency-Key repetida responde 200 duplicate e não reprocessa', async () => {
    const body = JSON.stringify(payloadFor(PROPOSAL_2));
    const first = await sendWebhook(body, { idempotencyKey: 'cglog-evt-dup' });
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    createdEventIds.push(first.body.event_id);

    const second = await sendWebhook(body, { idempotencyKey: 'cglog-evt-dup' });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.event_id).toBe(first.body.event_id);

    const count = await all<any>(
      'SELECT COUNT(*) AS c FROM webhook_events WHERE idempotency_key = $1',
      ['cglog:cglog-evt-dup']
    );
    expect(Number(count[0].c)).toBe(1);

    const dupLog = await get<any>(
      'SELECT * FROM integration_logs WHERE webhook_event_id = $1 AND status = $2',
      [first.body.event_id, 'warning']
    );
    expect(dupLog).toBeDefined();
    expect(dupLog.message).toContain('duplicado');
  });

  it('3. rejeita replay: timestamp fora da janela anti-replay (401)', async () => {
    const body = JSON.stringify(payloadFor(PROPOSAL_1));
    const old = Date.now() - 10 * 60 * 1000;
    const res = await sendWebhook(body, { timestamp: old });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('replay');
  });

  it('4. rejeita assinatura inválida (401)', async () => {
    const body = JSON.stringify(payloadFor(PROPOSAL_1));
    const res = await sendWebhook(body, { signature: 'a'.repeat(64) });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Assinatura inválida');
  });

  it('5. rejeita webhook sem X-Signature (401)', async () => {
    const body = JSON.stringify(payloadFor(PROPOSAL_1));
    const timestamp = Date.now();
    const res = await request(app)
      .post(`/api/integrations/webhooks/${SYSTEM_CODE}`)
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', String(timestamp))
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Assinatura');
  });

  it('6. rejeita sistema de integração inativo (401)', async () => {
    const body = JSON.stringify(payloadFor(PROPOSAL_1));
    const res = await sendWebhook(body, { system: INACTIVE_CODE });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('inativo');
  });

  it('7. evento sem demanda correspondente → unmatched (200, evento marcado)', async () => {
    const proposal = 'PROP-CGLOG-WEBHOOK-NAOEXISTE';
    const res = await sendWebhook(JSON.stringify(payloadFor(proposal)), { idempotencyKey: 'cglog-evt-nodemand' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');
    createdEventIds.push(res.body.event_id);

    const event = await get<any>('SELECT * FROM webhook_events WHERE id = $1', [res.body.event_id]);
    expect(event.status).toBe('unmatched');
    expect(event.error).toContain('demand not found');

    const log = await get<any>(
      'SELECT * FROM integration_logs WHERE webhook_event_id = $1 AND action = $2',
      [res.body.event_id, 'integration.sync']
    );
    expect(log.status).toBe('warning');
    expect(log.message).toContain('sem correspondência');
  });

  it('8. status externo sem mapeamento → unmatched (demanda não alterada)', async () => {
    await seedDemand(DEMAND_2_ID, PROPOSAL_2);
    const body = JSON.stringify(payloadFor(PROPOSAL_2, { status: 'EXOTICO' }));
    const res = await sendWebhook(body, { idempotencyKey: 'cglog-evt-statusdesconhecido' });
    expect(res.status).toBe(200);
    createdEventIds.push(res.body.event_id);

    const event = await get<any>('SELECT * FROM webhook_events WHERE id = $1', [res.body.event_id]);
    expect(event.status).toBe('unmatched');
    expect(event.error).toContain('Unknown external status');

    const demand = await get<any>('SELECT * FROM demands WHERE id = $1', [DEMAND_2_ID]);
    expect(demand.status).toBe('pendente');
  });

  it('9. payload sem proposta → unmatched (demand not found)', async () => {
    const body = JSON.stringify({ event: 'demand.updated', protocolo: 'CGLOG-WB-NAO-PROPOSTA', status: 'EM_ANALISE' });
    const res = await sendWebhook(body, { idempotencyKey: 'cglog-evt-semproposta' });
    expect(res.status).toBe(200);
    createdEventIds.push(res.body.event_id);

    const event = await get<any>('SELECT * FROM webhook_events WHERE id = $1', [res.body.event_id]);
    expect(event.status).toBe('unmatched');
    expect(event.error).toContain('demand not found');
  });

  it('10. corpo não-JSON é aceito (texto) mas não localiza demanda', async () => {
    const raw = 'protocolo=CGLOG-WB-RAW&status=EM_ANALISE';
    const timestamp = Date.now();
    const signature = sign(raw, SECRET, timestamp, 'cglog-evt-raw');
    const res = await request(app)
      .post(`/api/integrations/webhooks/${SYSTEM_CODE}`)
      .set('Content-Type', 'text/plain')
      .set('X-Timestamp', String(timestamp))
      .set('X-Signature', signature)
      .set('X-Idempotency-Key', 'cglog-evt-raw')
      .send(raw);
    expect(res.status).toBe(200);
    createdEventIds.push(res.body.event_id);

    const event = await get<any>('SELECT * FROM webhook_events WHERE id = $1', [res.body.event_id]);
    expect(event.event_type).toBe('unknown');
    expect(event.status).toBe('unmatched');
  });
});
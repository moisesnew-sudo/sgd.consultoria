import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import app from '../server.js';
import { run, get, all } from '../database.js';

const SECRET = 'teste-webhook-secret-1234567890';
const TEST_SECRET_ENV = 'TESTE_WEBHOOK_SECRET';
const SYSTEM_CODE = 'teste';

function sign(body: string, secret: string, timestamp: number, idempotencyKey?: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}\n`);
  if (idempotencyKey) hmac.update(`${idempotencyKey}\n`);
  hmac.update(body, 'utf8');
  return hmac.digest('hex');
}

const PAYLOAD = { event: 'demand.updated', demand: { proposal_number: 'TESTE-2026-001', status: 'analise' } };
const BODY = JSON.stringify(PAYLOAD);

async function sendWebhook(overrides: {
  system?: string;
  body?: string;
  contentType?: string;
  timestamp?: number;
  signature?: string;
  idempotencyKey?: string;
} = {}) {
  const system = overrides.system ?? SYSTEM_CODE;
  const body = overrides.body ?? BODY;
  const contentType = overrides.contentType ?? 'application/json';
  const timestamp = overrides.timestamp ?? Date.now();
  const signature = overrides.signature ?? sign(body, SECRET, timestamp, overrides.idempotencyKey);
  const req = request(app)
    .post(`/api/integrations/webhooks/${system}`)
    .set('Content-Type', contentType)
    .set('X-Timestamp', String(timestamp))
    .set('X-Signature', signature);
  if (overrides.idempotencyKey) req.set('X-Idempotency-Key', overrides.idempotencyKey);
  return req.send(body);
}

beforeAll(async () => {
  process.env[TEST_SECRET_ENV] = SECRET;
  await run('DELETE FROM integration_logs WHERE system_code = $1', [SYSTEM_CODE]);
  await run('DELETE FROM webhook_events WHERE system_code = $1', [SYSTEM_CODE]);
  await run('DELETE FROM integration_systems WHERE code IN ($1, $2)', [SYSTEM_CODE, 'testeinativo']);
  await run(
    "INSERT INTO integration_systems (code, name, secret_env_key) VALUES ($1, $2, $3)",
    [SYSTEM_CODE, 'Sistema Teste', TEST_SECRET_ENV]
  );
  await run(
    "INSERT INTO integration_systems (code, name, secret_env_key, active) VALUES ($1, $2, $3, FALSE)",
    ['testeinativo', 'Sistema Inativo', TEST_SECRET_ENV]
  );
});

describe('Webhooks (Fase 1)', () => {
  it('aceita webhook com assinatura HMAC válida (sem login e sem CSRF)', async () => {
    const res = await sendWebhook({ idempotencyKey: 'evt-001' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');
    expect(res.body.duplicate).toBe(false);
    expect(res.body.event_id).toBeTypeOf('number');
    expect(res.body.system).toBe(SYSTEM_CODE);

    const event = await get<any>(
      'SELECT * FROM webhook_events WHERE id = $1',
      [res.body.event_id]
    );
    expect(event).toBeDefined();
    expect(event.system_code).toBe(SYSTEM_CODE);
    expect(event.status).toBe('failed');
    expect(event.error).toContain('adapter not found');
    expect(event.event_type).toBe('demand.updated');
    expect(event.payload.demand.proposal_number).toBe('TESTE-2026-001');
    expect(event.idempotency_key).toBe(`teste:evt-001`);

    const log = await get<any>(
      'SELECT * FROM integration_logs WHERE webhook_event_id = $1',
      [res.body.event_id]
    );
    expect(log).toBeDefined();
    expect(log.direction).toBe('in');
    expect(log.action).toBe('webhook.received');
    expect(log.status).toBe('success');
  });

  it('gera idempotency_key a partir do payload quando X-Idempotency-Key ausente', async () => {
    const res = await sendWebhook();
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(false);

    const expectedKey = `${SYSTEM_CODE}:${crypto.createHash('sha256').update(BODY).digest('hex')}`;
    const event = await get<any>('SELECT * FROM webhook_events WHERE id = $1', [res.body.event_id]);
    expect(event.idempotency_key).toBe(expectedKey);
  });

  it('impede duplicidade: mesmo X-Idempotency-Key responde 200 e não duplica registro', async () => {
    const first = await sendWebhook({ idempotencyKey: 'evt-dup' });
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);

    const second = await sendWebhook({ idempotencyKey: 'evt-dup' });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.event_id).toBe(first.body.event_id);

    const count = await all<any>(
      'SELECT COUNT(*) as c FROM webhook_events WHERE idempotency_key = $1',
      ['teste:evt-dup']
    );
    expect(Number(count[0].c)).toBe(1);

    const dupLog = await get<any>(
      'SELECT * FROM integration_logs WHERE webhook_event_id = $1 AND status = $2',
      [first.body.event_id, 'warning']
    );
    expect(dupLog).toBeDefined();
  });

  it('rejeita webhook sem X-Signature (401)', async () => {
    const timestamp = Date.now();
    const res = await request(app)
      .post(`/api/integrations/webhooks/${SYSTEM_CODE}`)
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', String(timestamp))
      .send(BODY);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Assinatura');
  });

  it('rejeita assinatura inválida (401)', async () => {
    const res = await sendWebhook({ signature: 'a'.repeat(64) });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Assinatura inválida');
  });

  it('rejeita timestamp ausente (401)', async () => {
    const signature = sign(BODY, SECRET, Date.now());
    const res = await request(app)
      .post(`/api/integrations/webhooks/${SYSTEM_CODE}`)
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(BODY);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Timestamp');
  });

  it('rejeita timestamp fora da janela anti-replay (401)', async () => {
    const old = Date.now() - 10 * 60 * 1000;
    const res = await sendWebhook({ timestamp: old });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('replay');
  });

  it('rejeita sistema inexistente (401)', async () => {
    const res = await sendWebhook({ system: 'naoexiste' });
    expect(res.status).toBe(401);
  });

  it('rejeita sistema inativo (401)', async () => {
    const res = await sendWebhook({ system: 'testeinativo' });
    expect(res.status).toBe(401);
  });

  it('aceita body não-JSON (text/plain) com assinatura sobre bytes exatos', async () => {
    const raw = 'evento=status&proposta=ABC-1';
    const res = await sendWebhook({ body: raw, contentType: 'text/plain', idempotencyKey: 'evt-raw' });
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(false);

    const event = await get<any>('SELECT * FROM webhook_events WHERE id = $1', [res.body.event_id]);
    expect(event.event_type).toBe('unknown');
    expect(event.payload.raw_body).toBe(raw);
  });
});

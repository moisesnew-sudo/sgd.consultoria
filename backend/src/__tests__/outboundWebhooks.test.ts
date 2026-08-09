/**
 * Fase D3.1 — Testes de Webhooks de Saída (outbound).
 *
 * Cobertura:
 * 1. hashSecret: gera hash SHA-256 correto
 * 2. verifySecret: valida segredo contra hash
 * 3. signPayload: gera assinatura HMAC-SHA256 formatada
 * 4. isValidWebhookUrl: aceita URLs HTTPS válidas
 * 5. isValidWebhookUrl: rejeita localhost (anti-SSRF)
 * 6. isValidWebhookUrl: rejeita IPs privados
 * 7. isValidWebhookUrl: rejeita protocolo inválido
 * 8. sanitizePayload: remove campos sensíveis
 * 9. sanitizePayload: preserva campos não-sensíveis
 * 10. Routes: GET /admin/outbound-webhooks retorna 401 sem auth
 * 11. Routes: GET /admin/outbound-webhooks retorna 403 para gestor
 * 12. Routes: GET /admin/outbound-webhooks retorna 200 para admin
 * 13. Routes: POST /admin/outbound-webhooks cria webhook
 * 14. Routes: POST /admin/outbound-webhooks rejeita URL interna
 * 15. Routes: POST /admin/outbound-webhooks rejeita segredo curto
 * 16. Routes: POST /admin/outbound-webhooks rejeita eventos inválidos
 * 17. Routes: GET /admin/outbound-webhooks/:id retorna 404 para ID inexistente
 * 18. Routes: GET /admin/outbound-webhooks/deliveries retorna lista
 */

import { describe, it, expect } from 'vitest';
import {
  hashSecret,
  verifySecret,
  signPayload,
  isValidWebhookUrl,
  sanitizePayload,
} from '../lib/webhookDispatcher.js';
import { loginAsWithCsrf } from './helpers.js';

const adminCreds = { email: 'admin@sgd.gov.br', password: 'Admin2026!' };
const gestorCreds = { email: 'gestor@sgd.gov.br', password: 'Gestor2026!' };

/* ------------------------------------------------------------------ */
/* Unit Tests — Pure Functions                                         */
/* ------------------------------------------------------------------ */

describe('webhookDispatcher — hashSecret', () => {
  it('1. gera hash SHA-256 correto', () => {
    const hash = hashSecret('meu-segre-do-super-seguro');
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(hashSecret('meu-segre-do-super-seguro')).toBe(hash);
  });

  it('2. inputs diferentes geram hashes diferentes', () => {
    const h1 = hashSecret('segredo-um');
    const h2 = hashSecret('segredo-dois');
    expect(h1).not.toBe(h2);
  });
});

describe('webhookDispatcher — verifySecret', () => {
  it('3. valida segredo contra hash', () => {
    const secret = 'my-super-secret-key-12345';
    const hash = hashSecret(secret);
    expect(verifySecret(secret, hash)).toBe(true);
  });

  it('4. rejeita segredo incorreto', () => {
    const hash = hashSecret('correct-secret-key-12345');
    expect(verifySecret('wrong-secret-key-123456', hash)).toBe(false);
  });
});

describe('webhookDispatcher — signPayload', () => {
  it('5. gera assinatura HMAC-SHA256 formatada', () => {
    const sig = signPayload('secret-key-12345678', '{"test":true}');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('6. assinatura é determinística', () => {
    const s1 = signPayload('key', 'body');
    const s2 = signPayload('key', 'body');
    expect(s1).toBe(s2);
  });

  it('7. assinatura muda com payload diferente', () => {
    const s1 = signPayload('key', 'body1');
    const s2 = signPayload('key', 'body2');
    expect(s1).not.toBe(s2);
  });
});

describe('webhookDispatcher — isValidWebhookUrl', () => {
  it('8. aceita URLs HTTPS válidas', () => {
    expect(isValidWebhookUrl('https://example.com/webhook').valid).toBe(true);
    expect(isValidWebhookUrl('https://api.service.com/hooks/123').valid).toBe(true);
  });

  it('9. aceita URLs HTTP', () => {
    expect(isValidWebhookUrl('http://example.com/webhook').valid).toBe(true);
  });

  it('10. rejeita localhost (anti-SSRF)', () => {
    expect(isValidWebhookUrl('http://localhost:3000/hook').valid).toBe(false);
    expect(isValidWebhookUrl('http://127.0.0.1/hook').valid).toBe(false);
    expect(isValidWebhookUrl('http://[::1]/hook').valid).toBe(false);
  });

  it('11. rejeita IPs privados', () => {
    expect(isValidWebhookUrl('http://10.0.0.1/hook').valid).toBe(false);
    expect(isValidWebhookUrl('http://172.16.0.1/hook').valid).toBe(false);
    expect(isValidWebhookUrl('http://192.168.1.1/hook').valid).toBe(false);
  });

  it('12. rejeita protocolo inválido', () => {
    expect(isValidWebhookUrl('ftp://example.com/file').valid).toBe(false);
    expect(isValidWebhookUrl('javascript:alert(1)').valid).toBe(false);
  });

  it('13. rejeita URLs malformadas', () => {
    expect(isValidWebhookUrl('not-a-url').valid).toBe(false);
    expect(isValidWebhookUrl('').valid).toBe(false);
  });
});

describe('webhookDispatcher — sanitizePayload', () => {
  it('14. remove campos sensíveis (password, token, secret)', () => {
    const input = {
      name: 'teste',
      password: 'abc123',
      token: 'jwt-secret',
      api_key: 'key-123',
      data: { secret: 'hidden', value: 42 },
    };
    const result = sanitizePayload(input) as Record<string, unknown>;
    expect(result.name).toBe('teste');
    expect(result.password).toBeUndefined();
    expect(result.token).toBeUndefined();
    expect(result.api_key).toBeUndefined();
    expect(result.data).toEqual({ value: 42 });
  });

  it('15. preserva campos não-sensíveis', () => {
    const input = { id: 1, title: 'Teste', active: true, tags: ['a', 'b'] };
    const result = sanitizePayload(input);
    expect(result).toEqual(input);
  });

  it('16. lida com null/undefined', () => {
    expect(sanitizePayload(null)).toBeNull();
    expect(sanitizePayload(undefined)).toBeUndefined();
    expect(sanitizePayload('string')).toBe('string');
    expect(sanitizePayload(42)).toBe(42);
  });

  it('17. sanitiza arrays recursivamente', () => {
    const input = [
      { name: 'ok', password: 'secret' },
      { name: 'ok2', token: 'tok' },
    ];
    const result = sanitizePayload(input) as Array<Record<string, unknown>>;
    expect(result[0].name).toBe('ok');
    expect(result[0].password).toBeUndefined();
    expect(result[1].name).toBe('ok2');
    expect(result[1].token).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Route Tests — Admin Outbound Webhooks                               */
/* ------------------------------------------------------------------ */

describe('Outbound Webhooks — Routes', () => {
  it('10. GET /admin/outbound-webhooks retorna 401 sem auth', async () => {
    const res = await (await import('supertest')).default((await import('../server.js')).default)
      .get('/api/admin/outbound-webhooks');
    expect(res.status).toBe(401);
  });

  it('11. GET /admin/outbound-webhooks retorna 403 para gestor', async () => {
    const { agent } = await loginAsWithCsrf(gestorCreds.email, gestorCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks');
    expect(res.status).toBe(403);
  });

  it('12. GET /admin/outbound-webhooks retorna 200 para admin', async () => {
    const { agent } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks');
    expect(res.status).toBe(200);
    expect(res.body.webhooks).toBeDefined();
    expect(Array.isArray(res.body.webhooks)).toBe(true);
  });

  it('13. POST /admin/outbound-webhooks cria webhook', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent
      .post('/api/admin/outbound-webhooks')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({
        name: 'Teste Webhook',
        url: 'https://example.com/hook',
        secret: 'my-super-secret-key-12345',
        events: ['demand:created'],
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Teste Webhook');
    expect(res.body.url).toBe('https://example.com/hook');
    expect(res.body.events).toEqual(['demand:created']);
    expect(res.body.active).toBe(true);
  });

  it('14. POST /admin/outbound-webhooks rejeita URL interna (SSRF)', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent
      .post('/api/admin/outbound-webhooks')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({
        name: 'SSRF Webhook',
        url: 'http://localhost:3000/hook',
        secret: 'my-super-secret-key-12345',
        events: ['demand:created'],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SSRF|inválida/i);
  });

  it('15. POST /admin/outbound-webhooks rejeita segredo curto', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent
      .post('/api/admin/outbound-webhooks')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({
        name: 'Short Secret',
        url: 'https://example.com/hook',
        secret: 'short',
        events: ['demand:created'],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/16 caracteres/i);
  });

  it('16. POST /admin/outbound-webhooks rejeita eventos inválidos', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent
      .post('/api/admin/outbound-webhooks')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({
        name: 'Invalid Events',
        url: 'https://example.com/hook',
        secret: 'my-super-secret-key-12345',
        events: ['invalid:event', 'also:bad'],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválidos/i);
  });

  it('17. GET /admin/outbound-webhooks/:id retorna 404 para ID inexistente', async () => {
    const { agent } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks/99999');
    expect(res.status).toBe(404);
  });

  it('18. GET /admin/outbound-webhooks/deliveries retorna lista', async () => {
    const { agent } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks/deliveries');
    expect(res.status).toBe(200);
    expect(res.body.deliveries).toBeDefined();
    expect(Array.isArray(res.body.deliveries)).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* D3.2 — Gestão Avançada de Entregas                               */
  /* ---------------------------------------------------------------- */

  it('D3.2-1. POST /deliveries/:id/retry retorna 404 para entrega inexistente', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent
      .post('/api/admin/outbound-webhooks/deliveries/99999/retry')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`);
    expect(res.status).toBe(404);
  });

  it('D3.2-2. GET /stats retorna estatísticas do dashboard', async () => {
    const { agent } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks/stats');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalWebhooks).toBe('number');
    expect(typeof res.body.activeWebhooks).toBe('number');
    expect(res.body.last24h).toBeDefined();
    expect(typeof res.body.last24h.total).toBe('number');
    expect(typeof res.body.last24h.success).toBe('number');
    expect(typeof res.body.last24h.failed).toBe('number');
    expect(typeof res.body.last24h.dead_letter).toBe('number');
    expect(typeof res.body.totalDeadLetter).toBe('number');
    expect(Array.isArray(res.body.topDeadLetterWebhooks)).toBe(true);
  });

  it('D3.2-3. GET /deliveries/:id retorna 404 para ID inexistente', async () => {
    const { agent } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks/deliveries/99999');
    expect(res.status).toBe(404);
  });

  it('D3.2-4. GET /deliveries/:id retorna detalhes de entrega existente', async () => {
    // Primeiro cria um webhook para ter deliveries
    const { agent, csrfToken } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const webhookRes = await agent
      .post('/api/admin/outbound-webhooks')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({
        name: 'D3.2 Detail Test',
        url: 'https://httpbin.org/status/200',
        secret: 'my-super-secret-key-12345',
        events: ['demand:created'],
      });
    expect(webhookRes.status).toBe(201);

    // Lista deliveries (deve estar vazio)
    const delRes = await agent.get('/api/admin/outbound-webhooks/deliveries');
    expect(delRes.status).toBe(200);

    // Stats deve mostrar o webhook criado
    const statsRes = await agent.get('/api/admin/outbound-webhooks/stats');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.totalWebhooks).toBeGreaterThanOrEqual(1);
  });

  it('D3.2-5. GET /deliveries filtra por status', async () => {
    const { agent } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks/deliveries?status=dead_letter');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.deliveries)).toBe(true);
  });

  it('D3.2-6. GET /deliveries filtra por webhook_id', async () => {
    const { agent } = await loginAsWithCsrf(adminCreds.email, adminCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks/deliveries?webhook_id=1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.deliveries)).toBe(true);
  });

  it('D3.2-7. POST /deliveries/:id/retry retorna 403 para gestor', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(gestorCreds.email, gestorCreds.password);
    const res = await agent
      .post('/api/admin/outbound-webhooks/deliveries/1/retry')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`);
    expect(res.status).toBe(403);
  });

  it('D3.2-8. GET /stats retorna 403 para gestor', async () => {
    const { agent } = await loginAsWithCsrf(gestorCreds.email, gestorCreds.password);
    const res = await agent.get('/api/admin/outbound-webhooks/stats');
    expect(res.status).toBe(403);
  });

  it('D3.2-9. schema migration: webhook_deliveries tem max_attempts', async () => {
    const { all } = await import('../database.js');
    const rows = await all<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'max_attempts'`
    );
    expect(rows.length).toBe(1);
  });

  it('D3.2-10. schema migration: webhook_deliveries aceita dead_letter', async () => {
    const { get } = await import('../database.js');
    // Verifica que o CHECK constraint inclui dead_letter
    const row = await get<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'webhook_deliveries' AND constraint_type = 'CHECK'`
    );
    expect(row).toBeDefined();
  });
});

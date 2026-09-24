import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Request } from 'express';
import request from 'supertest';
import { run } from '../database.js';
import {
  resolveOrganization,
  resolveOrganizationFromRequest,
  normalizeHost,
} from '../middleware/organizationResolver.js';

// ETAPA 3 (AUXAMO): resolucao segura de organization por Host.
// Harness isolado (express local) — o middleware NAO e montado em server.ts
// nesta etapa, logo nenhum comportamento de producao muda. Fixtures transientes
// com stamp, removidas em afterAll; org 1 nunca e alterada.
const stamp = Date.now();
const ACTIVE_SLUG = `rs-${stamp}`;
const ACTIVE_DOMAIN = `rs-${stamp}.example.invalid`;
const INACTIVE_SLUG = `rs-inactive-${stamp}`;
const INACTIVE_DOMAIN = `rs-inactive-${stamp}.example.invalid`;
const UNKNOWN_DOMAIN = `unknown-${stamp}.example.invalid`;

function fakeReq(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

function buildHarness() {
  const app = express();
  app.use(resolveOrganization);
  app.get('/ctx', (req, res) => {
    res.json({ organization: req.organization ?? null });
  });
  return app;
}

describe('organizationResolver — resolucao por Host', () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeAll(async () => {
    await run(
      `INSERT INTO organizations (name, slug, primary_domain, status)
       VALUES ('Resolver Active', $1, $2, 'active')`,
      [ACTIVE_SLUG, ACTIVE_DOMAIN]
    );
    await run(
      `INSERT INTO organizations (name, slug, primary_domain, status)
       VALUES ('Resolver Inactive', $1, $2, 'inactive')`,
      [INACTIVE_SLUG, INACTIVE_DOMAIN]
    );
    harness = buildHarness();
  });

  afterAll(async () => {
    await run('DELETE FROM organizations WHERE slug = ANY($1::text[])', [
      [ACTIVE_SLUG, INACTIVE_SLUG],
    ]);
  });

  it('1. dominio exato resolve a organization', async () => {
    const res = await request(harness).get('/ctx').set('Host', ACTIVE_DOMAIN);
    expect(res.status).toBe(200);
    expect(res.body.organization.slug).toBe(ACTIVE_SLUG);
  });

  it('2. dominio uppercase resolve apos normalizacao', async () => {
    const res = await request(harness).get('/ctx').set('Host', ACTIVE_DOMAIN.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body.organization.slug).toBe(ACTIVE_SLUG);
  });

  it('3. host com porta valida resolve', async () => {
    const res = await request(harness).get('/ctx').set('Host', `${ACTIVE_DOMAIN}:8443`);
    expect(res.status).toBe(200);
    expect(res.body.organization.slug).toBe(ACTIVE_SLUG);
  });

  it('4. host desconhecido NAO cai no tenant 1', async () => {
    const res = await request(harness).get('/ctx').set('Host', UNKNOWN_DOMAIN);
    expect(res.status).toBe(404);
    expect(res.body.organization).toBeUndefined();
  });

  it('5. organization inativa e rejeitada com 403, sem vazar dados', async () => {
    const res = await request(harness).get('/ctx').set('Host', INACTIVE_DOMAIN);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(res.body.organization).toBeUndefined();
  });

  it('6. protocolo no host e rejeitado', async () => {
    expect(normalizeHost('https://sgd.example.com')).toBeNull();
    const r = await resolveOrganizationFromRequest(fakeReq({ host: 'https://sgd.example.com' }));
    expect(r.status).toBe('invalid');
  });

  it('7. path no host e rejeitado', async () => {
    expect(normalizeHost('sgd.example.com/login')).toBeNull();
    const r = await resolveOrganizationFromRequest(fakeReq({ host: 'sgd.example.com/login' }));
    expect(r.status).toBe('invalid');
  });

  it('8. host com CRLF e rejeitado', async () => {
    expect(normalizeHost('sgd.example.com\r\nX-Injected: 1')).toBeNull();
    expect(normalizeHost('sgd.example.com\n')).toBeNull();
    const r = await resolveOrganizationFromRequest(
      fakeReq({ host: 'sgd.example.com\r\nX-Injected: 1' })
    );
    expect(r.status).toBe('invalid');
  });

  it('9. lista de hosts/multiplos valores e rejeitada', async () => {
    expect(normalizeHost('sgd.example.com,evil.com')).toBeNull();
    const res = await request(harness).get('/ctx').set('Host', `${ACTIVE_DOMAIN},evil.com`);
    expect(res.status).toBe(400);
  });

  it('10. host vazio e rejeitado', async () => {
    expect(normalizeHost('')).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
    const r = await resolveOrganizationFromRequest(fakeReq({}));
    expect(r.status).toBe('invalid');
  });

  it('11. valor excessivamente longo e rejeitado', async () => {
    expect(normalizeHost(`${'a'.repeat(300)}.com`)).toBeNull();
  });

  it('12. Origin nao influencia a resolucao', async () => {
    const ok = await request(harness)
      .get('/ctx')
      .set('Host', ACTIVE_DOMAIN)
      .set('Origin', 'https://evil.example.com');
    expect(ok.status).toBe(200);
    expect(ok.body.organization.slug).toBe(ACTIVE_SLUG);

    const unknown = await request(harness)
      .get('/ctx')
      .set('Host', UNKNOWN_DOMAIN)
      .set('Origin', 'https://api.gruposgd.com.br');
    expect(unknown.status).toBe(404);
  });

  it('13. tenantId no body NAO influencia o resolver', async () => {
    const res = await request(harness)
      .get('/ctx')
      .set('Host', UNKNOWN_DOMAIN)
      .send({ tenantId: 1 });
    expect(res.status).toBe(404);
  });

  it('14. tenantId na query NAO influencia o resolver', async () => {
    const res = await request(harness).get('/ctx?tenantId=1').set('Host', UNKNOWN_DOMAIN);
    expect(res.status).toBe(404);
  });

  it('15. header X-Tenant-Id NAO influencia o resolver', async () => {
    const res = await request(harness)
      .get('/ctx')
      .set('Host', UNKNOWN_DOMAIN)
      .set('X-Tenant-Id', '1');
    expect(res.status).toBe(404);

    const ok = await request(harness)
      .get('/ctx')
      .set('Host', ACTIVE_DOMAIN)
      .set('X-Tenant-Id', '999');
    expect(ok.status).toBe(200);
    expect(ok.body.organization.slug).toBe(ACTIVE_SLUG);
  });

  it('16. req.organization contem o tenant correto e nada sensivel', async () => {
    const res = await request(harness).get('/ctx').set('Host', ACTIVE_DOMAIN);
    expect(res.status).toBe(200);
    expect(res.body.organization).toBeDefined();
    expect(Object.keys(res.body.organization).sort()).toEqual([
      'id',
      'name',
      'primary_domain',
      'slug',
      'status',
    ]);
    expect(res.body.organization.slug).toBe(ACTIVE_SLUG);
    expect(res.body.organization.primary_domain).toBe(ACTIVE_DOMAIN);
  });

  it('17. ambiente test/dev resolve localhost sem fallback inseguro em producao', async () => {
    const local = await request(harness).get('/ctx').set('Host', 'localhost');
    expect(local.status).toBe(200);
    expect(local.body.organization.id).toBe(1);
    expect(local.body.organization.slug).toBe('sgd');

    const loopback = await request(harness).get('/ctx').set('Host', '127.0.0.1');
    expect(loopback.status).toBe(200);
    expect(loopback.body.organization.id).toBe(1);

    // Em producao o atalho localhost NAO existe: host desconhecido.
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const prod = await resolveOrganizationFromRequest(fakeReq({ host: 'localhost' }));
      expect(prod.status).toBe('unknown');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('IPv4 nao-local desconhecido nao resolve; IPv6 e explicitamente rejeitado', async () => {
    const v4 = await request(harness).get('/ctx').set('Host', '10.20.30.40');
    expect(v4.status).toBe(404);
    expect(normalizeHost('[::1]')).toBeNull();
    expect(normalizeHost('2001:db8::1')).toBeNull();
  });

  it('porta invalida e rejeitada', async () => {
    expect(normalizeHost(`${ACTIVE_DOMAIN}:abc`)).toBeNull();
    expect(normalizeHost(`${ACTIVE_DOMAIN}:`)).toBeNull();
    const res = await request(harness).get('/ctx').set('Host', `${ACTIVE_DOMAIN}:abc`);
    expect(res.status).toBe(400);
  });
});

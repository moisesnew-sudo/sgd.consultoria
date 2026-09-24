import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { get, run, all, initDatabase } from '../database.js';
import {
  GOVERNMENT_INTEGRATIONS,
  hasOrganizationCapability,
  getOrganizationCapabilities,
  setOrganizationCapability,
} from '../lib/organizationCapabilities.js';
import { requireCapability } from '../middleware/requireCapability.js';
import { requirePermission } from '../middleware/auth.js';
import { runScheduledSyncCycle } from '../lib/integrationScheduler.js';
import { loginAs } from './helpers.js';

// ETAPA 4 (AUXAMO): capabilities por organizacao, fail closed.
// Fixtures transientes com stamp, removidas em afterAll. Nenhum tenant real
// criado; org 1 (SGD) nunca e alterada alem do seed idempotente.
const stamp = Date.now();
const ORG_A_SLUG = `cap-a-${stamp}`;
const ORG_B_SLUG = `cap-b-${stamp}`;
const SYS_CODE = `cap-sys-${stamp}`;
const FOREIGN_TENANT = 424242;

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only';

function forgedAdminJwt(tenantId: number): string {
  return jwt.sign(
    { id: 999999, email: 'cap-forge@invalid', name: 'Cap Forge', role: 'admin', tenant_id: tenantId },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

async function orgIdBySlug(slug: string): Promise<number> {
  const row = await get<{ id: number }>('SELECT id FROM organizations WHERE slug = $1', [slug]);
  if (!row) throw new Error(`fixture org ausente: ${slug}`);
  return row.id;
}

describe('organization capabilities — government_integrations', () => {
  let app: ReturnType<typeof express>;

  beforeAll(async () => {
    await initDatabase();
    await run(`INSERT INTO organizations (name, slug, status) VALUES ('Cap A', $1, 'active')`, [
      ORG_A_SLUG,
    ]);
    await run(`INSERT INTO organizations (name, slug, status) VALUES ('Cap B', $1, 'active')`, [
      ORG_B_SLUG,
    ]);
    await setOrganizationCapability(await orgIdBySlug(ORG_A_SLUG), GOVERNMENT_INTEGRATIONS, true);

    app = express();
    app.use(express.json());
  });

  afterAll(async () => {
    const ids = await all<{ id: number }>('SELECT id FROM organizations WHERE slug = ANY($1::text[])', [
      [ORG_A_SLUG, ORG_B_SLUG],
    ]);
    for (const r of ids) {
      await run('DELETE FROM organization_capabilities WHERE organization_id = $1', [r.id]);
    }
    await run('DELETE FROM integration_systems WHERE code = $1', [SYS_CODE]);
    await run('DELETE FROM organizations WHERE slug = ANY($1::text[])', [[ORG_A_SLUG, ORG_B_SLUG]]);
  });

  it('1. org 1 possui government_integrations=true (seed)', async () => {
    expect(await hasOrganizationCapability(1, GOVERNMENT_INTEGRATIONS)).toBe(true);
    expect((await getOrganizationCapabilities(1))[GOVERNMENT_INTEGRATIONS]).toBe(true);
  });

  it('2. seed/idempotencia: boots repetidos nao duplicam a capability', async () => {
    await initDatabase();
    await initDatabase();
    const rows = await all<{ enabled: boolean }>(
      `SELECT enabled FROM organization_capabilities WHERE organization_id = 1 AND capability = $1`,
      [GOVERNMENT_INTEGRATIONS]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].enabled).toBe(true);
  });

  it('3. capability ausente implica false', async () => {
    expect(await hasOrganizationCapability(await orgIdBySlug(ORG_B_SLUG), GOVERNMENT_INTEGRATIONS)).toBe(
      false
    );
  });

  it('4. enabled=false implica false', async () => {
    const idB = await orgIdBySlug(ORG_B_SLUG);
    await setOrganizationCapability(idB, GOVERNMENT_INTEGRATIONS, false);
    expect(await hasOrganizationCapability(idB, GOVERNMENT_INTEGRATIONS)).toBe(false);
  });

  it('5. enabled=true implica true', async () => {
    const idA = await orgIdBySlug(ORG_A_SLUG);
    expect(await hasOrganizationCapability(idA, GOVERNMENT_INTEGRATIONS)).toBe(true);
  });

  it('5b. INSERT sem enabled nasce DESABILITADO (secure-default do schema)', async () => {
    const slugC = `cap-c-${stamp}`;
    await run(`INSERT INTO organizations (name, slug, status) VALUES ('Cap C', $1, 'active')`, [
      slugC,
    ]);
    try {
      const idC = await orgIdBySlug(slugC);
      await run(
        `INSERT INTO organization_capabilities (organization_id, capability)
         VALUES ($1, $2)`,
        [idC, GOVERNMENT_INTEGRATIONS]
      );
      const direct = await get<{ enabled: boolean }>(
        `SELECT enabled FROM organization_capabilities WHERE organization_id = $1 AND capability = $2`,
        [idC, GOVERNMENT_INTEGRATIONS]
      );
      expect(direct?.enabled).toBe(false);
      expect(await hasOrganizationCapability(idC, GOVERNMENT_INTEGRATIONS)).toBe(false);
    } finally {
      await run('DELETE FROM organization_capabilities WHERE organization_id = (SELECT id FROM organizations WHERE slug = $1)', [
        slugC,
      ]);
      await run('DELETE FROM organizations WHERE slug = $1', [slugC]);
    }
  });

  it('5c. operador desabilita SGD e reboot NAO reativa (sem reabilitacao automatica)', async () => {
    await run(
      `UPDATE organization_capabilities SET enabled = FALSE, updated_at = NOW()
       WHERE organization_id = 1 AND capability = $1`,
      [GOVERNMENT_INTEGRATIONS]
    );
    try {
      expect(await hasOrganizationCapability(1, GOVERNMENT_INTEGRATIONS)).toBe(false);
      await initDatabase();
      await initDatabase();
      expect(await hasOrganizationCapability(1, GOVERNMENT_INTEGRATIONS)).toBe(false);
      const rows = await all<{ enabled: boolean }>(
        `SELECT enabled FROM organization_capabilities WHERE organization_id = 1 AND capability = $1`,
        [GOVERNMENT_INTEGRATIONS]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].enabled).toBe(false);
    } finally {
      // Restaura o estado esperado pelos demais cenarios (o seed nao reabilita sozinho).
      await setOrganizationCapability(1, GOVERNMENT_INTEGRATIONS, true);
    }
    expect(await hasOrganizationCapability(1, GOVERNMENT_INTEGRATIONS)).toBe(true);
  });

  it('6. capability do tenant A nao vale para o tenant B', async () => {
    const idA = await orgIdBySlug(ORG_A_SLUG);
    const idB = await orgIdBySlug(ORG_B_SLUG);
    expect(await hasOrganizationCapability(idA, GOVERNMENT_INTEGRATIONS)).toBe(true);
    await setOrganizationCapability(idB, GOVERNMENT_INTEGRATIONS, false);
    expect(await hasOrganizationCapability(idB, GOVERNMENT_INTEGRATIONS)).toBe(false);
  });

  it('entradas invalidas nunca habilitam (fail closed, sem tenant valido)', async () => {
    expect(await hasOrganizationCapability(0, GOVERNMENT_INTEGRATIONS)).toBe(false);
    expect(await hasOrganizationCapability(-3, GOVERNMENT_INTEGRATIONS)).toBe(false);
    expect(await hasOrganizationCapability(Number.NaN, GOVERNMENT_INTEGRATIONS)).toBe(false);
    expect(await getOrganizationCapabilities(0)).toEqual({});
  });

  function harnessWithUser(user: object, withRbac = false) {
    const h = express();
    h.use(express.json());
    h.use((req, _res, next) => {
      req.user = user as never;
      next();
    });
    if (withRbac) {
      h.get('/r', requireCapability(GOVERNMENT_INTEGRATIONS), requirePermission('integrations.view'), (_req, res) => {
        res.json({ ok: true });
      });
    } else {
      h.get('/r', requireCapability(GOVERNMENT_INTEGRATIONS), (_req, res) => {
        res.json({ ok: true });
      });
    }
    return h;
  }

  const adminUser = (tenantId: number) => ({
    id: 999999,
    email: 'cap-harness@invalid',
    name: 'Cap Harness',
    role: 'admin',
    tenant_id: tenantId,
    permissions: [] as string[],
  });

  it('7. requireCapability permite tenant habilitado', async () => {
    const h = harnessWithUser(adminUser(await orgIdBySlug(ORG_A_SLUG)));
    const res = await request(h).get('/r');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('8. requireCapability rejeita tenant sem capability com 403 generico', async () => {
    const h = harnessWithUser(adminUser(await orgIdBySlug(ORG_B_SLUG)));
    const res = await request(h).get('/r');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('9. body tenantId nao altera a decisao', async () => {
    const h = harnessWithUser(adminUser(await orgIdBySlug(ORG_B_SLUG)));
    const res = await request(h).post('/r').send({ tenantId: 1 });
    expect([403, 404]).toContain(res.status);
  });

  it('10. query tenantId nao altera a decisao', async () => {
    const h = harnessWithUser(adminUser(await orgIdBySlug(ORG_B_SLUG)));
    const res = await request(h).get('/r?tenantId=1');
    expect(res.status).toBe(403);
  });

  it('11. header X-Tenant-Id nao altera a decisao', async () => {
    const h = harnessWithUser(adminUser(await orgIdBySlug(ORG_B_SLUG)));
    const res = await request(h).get('/r').set('X-Tenant-Id', '1');
    expect(res.status).toBe(403);
  });

  it('12. RBAC continua exigido apos a capability', async () => {
    const idA = await orgIdBySlug(ORG_A_SLUG);
    const noPermUser = {
      id: 999998,
      email: 'cap-noperm@invalid',
      name: 'Cap NoPerm',
      role: 'consulta',
      tenant_id: idA,
      permissions: [] as string[],
    };
    const h = harnessWithUser(noPermUser, true);
    const res = await request(h).get('/r');
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toContain('Acesso negado');

    const ok = await request(harnessWithUser(adminUser(idA), true)).get('/r');
    expect(ok.status).toBe(200);
  });

  it('13. endpoint de integration admin bloqueado sem capability', async () => {
    const { default: serverApp } = await import('../server.js');
    const res = await request(serverApp)
      .get('/api/integrations/admin/overview')
      .set('Authorization', `Bearer ${forgedAdminJwt(FOREIGN_TENANT)}`);
    expect(res.status).toBe(403);
  });

  it('14. endpoint funciona para o tenant 1 (capability ativa)', async () => {
    const agent = await loginAs('admin@sgd.gov.br', 'Admin2026!');
    const res = await agent.get('/api/integrations/admin/overview');
    expect(res.status).toBe(200);
  });

  it('15. scheduler ignora tenant sem capability (sem sync, sem logs)', async () => {
    const idB = await orgIdBySlug(ORG_B_SLUG);
    await run(
      `INSERT INTO integration_systems (code, name, secret_env_key, active, config, tenant_id)
       VALUES ($1, 'Cap Scheduler', 'TEST_CAP_SCHED', TRUE,
               '{"syncEnabled":true,"syncIntervalMinutes":1,"maxRecordsPerSync":1}'::jsonb, $2)`,
      [SYS_CODE, idB]
    );
    await runScheduledSyncCycle();
    const logs = await all<{ id: number }>(
      `SELECT id FROM integration_logs WHERE system_code = $1`,
      [SYS_CODE]
    );
    expect(logs.length).toBe(0);
    const sys = await get<{ last_sync_at: string | null }>(
      `SELECT last_sync_at FROM integration_systems WHERE code = $1 AND tenant_id = $2`,
      [SYS_CODE, idB]
    );
    expect(sys?.last_sync_at).toBeNull();
  });

  it('16. tenant sem capability nao gera chamada externa nem altera demandas', async () => {
    const idB = await orgIdBySlug(ORG_B_SLUG);
    const before = await get<{ count: string }>(
      `SELECT COUNT(*) AS count FROM demands WHERE tenant_id = $1`,
      [idB]
    );
    await runScheduledSyncCycle();
    const after = await get<{ count: string }>(
      `SELECT COUNT(*) AS count FROM demands WHERE tenant_id = $1`,
      [idB]
    );
    expect(after?.count).toBe(before?.count);
    const events = await all<{ id: number }>(
      `SELECT id FROM webhook_events WHERE tenant_id = $1`,
      [idB]
    );
    expect(events.length).toBe(0);
  });
});

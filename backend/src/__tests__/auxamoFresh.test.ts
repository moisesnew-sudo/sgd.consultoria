import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ETAPA 5 (AUXAMO): initDatabase() em PostgreSQL vazio precisa provisionar a
// organizacao permanente id=2 (AUXAMO, sem dominio, gov=false, settings
// neutras), de forma idempotente e sem sobrescrever dados deliberados.
// Espelha o padrao de organizationsFresh/capabilitiesFresh (database scratch
// proprio + vi.resetModules + guarda current_database).
const SCRATCH_DB = 'sgd_auxamo_fresh_boot';

function withDb(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

const baseUrl =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/sgd';

let db: typeof import('../database.js');
let adminPool: pg.Pool;

describe('initDatabase fresco com tenant AUXAMO', () => {
  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: withDb(baseUrl, 'postgres') });
    await adminPool.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await adminPool.query(`CREATE DATABASE "${SCRATCH_DB}"`);
    process.env.DATABASE_URL = withDb(baseUrl, SCRATCH_DB);
    vi.resetModules();
    db = await import('../database.js');
    const current = await db.get<{ current_database: string }>(`SELECT current_database()`);
    expect(current?.current_database).toBe(SCRATCH_DB);
  }, 60000);

  afterAll(async () => {
    await db.pool.end().catch(() => undefined);
    await adminPool.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await adminPool.end();
  });

  it('banco vazio: AUXAMO provisionada com gov=false e settings neutras', async () => {
    await db.initDatabase();
    const org = await db.get<{ id: number; name: string; slug: string; status: string; primary_domain: string | null }>(
      `SELECT id, name, slug, status, primary_domain FROM organizations WHERE id = 2`
    );
    expect(org?.id).toBe(2);
    expect(org?.name).toBe('AUXAMO');
    expect(org?.slug).toBe('auxamo');
    expect(org?.status).toBe('active');
    expect(org?.primary_domain).toBeNull();

    const cap = await db.get<{ enabled: boolean }>(
      `SELECT enabled FROM organization_capabilities
       WHERE organization_id = 2 AND capability = 'government_integrations'`
    );
    expect(cap?.enabled).toBe(false);

    const settings = await db.get<{ tenant_id: number }>(
      `SELECT tenant_id FROM system_settings WHERE tenant_id = 2`
    );
    expect(settings?.tenant_id).toBe(2);

    const systems = await db.all<{ id: number }>(
      `SELECT id FROM integration_systems WHERE tenant_id = 2`
    );
    expect(systems.length).toBe(0);

    const users = await db.all<{ id: number }>(`SELECT id FROM users WHERE tenant_id = 2`);
    expect(users.length).toBe(0);
  });

  it('boots repetidos sao idempotentes e preservam alteracoes deliberadas', async () => {
    await db.initDatabase();
    await db.run(`UPDATE organizations SET name = 'Auxamo Fresh Custom' WHERE id = 2`);
    await db.run(
      `UPDATE system_settings SET budget_cap = 42 WHERE tenant_id = 2`
    );
    await db.initDatabase();
    const org = await db.get<{ name: string; slug: string }>(
      `SELECT name, slug FROM organizations WHERE id = 2`
    );
    expect(org?.name).toBe('Auxamo Fresh Custom');
    expect(org?.slug).toBe('auxamo');
    const settings = await db.get<{ budget_cap: string }>(
      `SELECT budget_cap FROM system_settings WHERE tenant_id = 2`
    );
    expect(String(settings?.budget_cap)).toBe('42');
    const orgs = await db.all<{ id: number }>(`SELECT id FROM organizations WHERE id = 2`);
    expect(orgs.length).toBe(1);
    const next = await db.get<{ id: number }>(
      `INSERT INTO organizations (name, slug, status) VALUES ('Aux Seq', 'aux-seq-fresh', 'active') RETURNING id`
    );
    expect(next!.id).toBeGreaterThan(2);
    await db.run(`DELETE FROM organizations WHERE slug = 'aux-seq-fresh'`);
  });
});

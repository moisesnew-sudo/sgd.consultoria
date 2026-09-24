import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ETAPA 2 (AUXAMO): initDatabase() em PostgreSQL totalmente vazio precisa criar
// a tabela organizations, semear a org id=1 e convergir a unicidade
// (tenant_id, code) de integration_systems — de forma idempotente.
// Espelha o padrao de initDatabaseFresh.test.ts com database scratch proprio.
const SCRATCH_DB = 'sgd_orgs_fresh_boot';

function withDb(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

const baseUrl =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/sgd';

let db: typeof import('../database.js');
let adminPool: pg.Pool;

describe('initDatabase fresco com fundacao organizations', () => {
  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: withDb(baseUrl, 'postgres') });
    await adminPool.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await adminPool.query(`CREATE DATABASE "${SCRATCH_DB}"`);
    process.env.DATABASE_URL = withDb(baseUrl, SCRATCH_DB);
    // setup.ts importa database.js estaticamente (pool do banco compartilhado);
    // sem resetModules o import dinamico retornaria o modulo em cache e os
    // inserts iriam para o banco errado. Reavalia o modulo com o env atual.
    vi.resetModules();
    db = await import('../database.js');
    const current = await db.get<{ current_database: string }>(
      `SELECT current_database()`
    );
    expect(current?.current_database).toBe(SCRATCH_DB);
  }, 60000);

  afterAll(async () => {
    await db.pool.end().catch(() => undefined);
    await adminPool.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await adminPool.end();
  });

  it('banco vazio: cria organizations, semeia org 1 e converge unicidade por tenant', async () => {
    await db.initDatabase();

    const tables = await db.all<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN ('organizations', 'integration_systems', 'system_settings')`
    );
    expect(tables.map((t) => t.table_name).sort()).toEqual([
      'integration_systems',
      'organizations',
      'system_settings',
    ]);

    const org = await db.get<{ id: number; slug: string; name: string; status: string }>(
      `SELECT id, slug, name, status FROM organizations WHERE id = 1`
    );
    expect(org?.id).toBe(1);
    expect(org?.slug).toBe('sgd');
    expect(org?.name).toBe('SGD Consultoria');
    expect(org?.status).toBe('active');

    // Unicidade composta existe; a global legada nao existe.
    const idx = await db.all<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'integration_systems'`
    );
    const names = idx.map((r) => r.indexname);
    expect(names).toContain('uq_integration_systems_tenant_code');
    const legacy = await db.all<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'integration_systems'::regclass AND conname = 'integration_systems_code_key'`
    );
    expect(legacy.length).toBe(0);

    // Dois tenants podem compartilhar o mesmo code em banco fresco.
    await db.run(
      `INSERT INTO integration_systems (code, name, secret_env_key, tenant_id)
       VALUES ('freshcode', 'Fresh T1', 'TEST_FRESH_1', 1)`
    );
    await db.run(
      `INSERT INTO integration_systems (code, name, secret_env_key, tenant_id)
       VALUES ('freshcode', 'Fresh T2', 'TEST_FRESH_2', 2)`
    );
    const rows = await db.all<{ tenant_id: number }>(
      `SELECT tenant_id FROM integration_systems WHERE code = 'freshcode' ORDER BY tenant_id`
    );
    expect(rows.map((r) => r.tenant_id)).toEqual([1, 2]);
  });

  it('segundo boot e idempotente: org 1 unica, sequence alinhada', async () => {
    await db.initDatabase();
    await db.initDatabase();
    const count = await db.get<{ count: string }>(
      `SELECT COUNT(*) AS count FROM organizations WHERE id = 1`
    );
    expect(count?.count).toBe('1');
    const nextId = await db.get<{ id: number }>(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Org Seq', 'org-seq-check', 'active') RETURNING id`
    );
    // Sequence realinhada apos o seed com id explicito: proximo id > 1.
    expect(nextId!.id).toBeGreaterThan(1);
    await db.run(`DELETE FROM organizations WHERE id = $1`, [nextId!.id]);
  });
});

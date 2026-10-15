import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ETAPA 4 (AUXAMO): initDatabase() em PostgreSQL vazio precisa semear a
// capability government_integrations=true da org 1, de forma idempotente.
// Espelha o padrao de organizationsFresh.test.ts com database scratch proprio
// (vi.resetModules + guarda current_database: setup.ts importa database.js
// estaticamente e o import dinamico retornaria o modulo em cache).
const SCRATCH_DB = 'sgd_caps_fresh_boot';

function withDb(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

const baseUrl =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/sgd';

let db: typeof import('../database.js');
let adminPool: pg.Pool;

describe('initDatabase fresco com capability SGD', () => {
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

  it('17. banco vazio: capability government_integrations=true semeada para org 1', async () => {
    await db.initDatabase();
    const row = await db.get<{ organization_id: number; enabled: boolean }>(
      `SELECT organization_id, enabled FROM organization_capabilities
       WHERE organization_id = 1 AND capability = 'government_integrations'`
    );
    expect(row?.organization_id).toBe(1);
    expect(row?.enabled).toBe(true);
  });

  it('18. boots repetidos sao idempotentes (linha unica, sem reabilitar)', async () => {
    await db.initDatabase();
    await db.initDatabase();
    const rows = await db.all<{ enabled: boolean }>(
      `SELECT enabled FROM organization_capabilities
       WHERE organization_id = 1 AND capability = 'government_integrations'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].enabled).toBe(true);
  });
});

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Regressao: initDatabase() precisa inicializar um PostgreSQL totalmente vazio
// (foi o que quebrou o CI: ALTER TABLE antes do CREATE TABLE correspondente).
// Usa um database scratch proprio; DATABASE_URL so e trocada antes do import
// dinamico porque cada arquivo de teste tem module graph isolado.
const SCRATCH_DB = 'sgd_fresh_boot';

function withDb(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

const baseUrl =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/sgd';

let db: typeof import('../database.js');
let adminPool: pg.Pool;

async function tableExists(pool: pg.Pool, table: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table]
  );
  return r.rowCount === 1;
}

describe('initDatabase em PostgreSQL vazio', () => {
  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: withDb(baseUrl, 'postgres') });
    await adminPool.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await adminPool.query(`CREATE DATABASE "${SCRATCH_DB}"`);
    process.env.DATABASE_URL = withDb(baseUrl, SCRATCH_DB);
    db = await import('../database.js');
  }, 60000);

  afterAll(async () => {
    await db.pool.end().catch(() => undefined);
    await adminPool.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await adminPool.end();
  });

  it('cenario A: primeiro boot em banco vazio cria o schema inteiro', async () => {
    await db.initDatabase();
    for (const t of [
      'users', 'demands', 'municipalities', 'timeline_events', 'comments',
      'attachments', 'audit_logs', 'demand_versions', 'refresh_tokens',
      'active_sessions', 'export_logs', 'backups', 'organs', 'monitoring_logs',
      'system_settings', 'permissions', 'user_permissions', 'role_permissions',
    ]) {
      expect(await tableExists(db.pool, t)).toBe(true);
    }
    const cols = await db.all<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'system_settings' AND column_name IN ('tenant_id', 'id')`
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual(['tenant_id']);
  });

  it('cenario B: segundo boot e idempotente e preserva o estado', async () => {
    await db.initDatabase();
    await db.initDatabase();
    const pk = await db.all<{ attname: string }>(
      `SELECT a.attname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'system_settings'::regclass AND c.contype = 'p'`
    );
    expect(pk.map((r) => r.attname)).toEqual(['tenant_id']);
    expect(await tableExists(db.pool, 'export_logs')).toBe(true);
  });
});

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Database pool error:', err);
});

export async function query(sql: string, params?: any[]) {
  const result = await pool.query(sql, params);
  return result;
}

export async function get<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
  const result = await pool.query(sql, params);
  return result.rows[0] as T | undefined;
}

export async function all<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function run(sql: string, params?: any[]) {
  const result = await pool.query(sql, params);
  return result;
}

export async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'viewer')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS municipalities (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      uf TEXT NOT NULL,
      demands_count INTEGER DEFAULT 0,
      total_value NUMERIC DEFAULT 0,
      schools_count INTEGER DEFAULT 0,
      population INTEGER DEFAULT 0,
      hdi NUMERIC DEFAULT 0,
      region TEXT CHECK(region IN ('Norte', 'Nordeste', 'Sudeste', 'Sul', 'Centro-Oeste')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name, uf)
    );

    CREATE TABLE IF NOT EXISTS demands (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      status TEXT DEFAULT 'pendente' CHECK(status IN ('analise', 'pendente', 'concluido', 'rejeitado')),
      priority TEXT DEFAULT 'media' CHECK(priority IN ('baixa', 'media', 'alta', 'urgente')),
      municipality TEXT NOT NULL,
      uf TEXT NOT NULL,
      requested_value NUMERIC DEFAULT 0,
      prefeitura TEXT,
      proposal_number TEXT,
      organ TEXT,
      process_link TEXT,
      responsible_name TEXT,
      responsible_email TEXT,
      responsible_phone TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      user_name TEXT NOT NULL,
      status_changed_to TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      size TEXT,
      type TEXT,
      file_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      sla_days_baixa INTEGER DEFAULT 45,
      sla_days_media INTEGER DEFAULT 30,
      sla_days_alta INTEGER DEFAULT 15,
      sla_days_urgente INTEGER DEFAULT 5,
      auto_triage BOOLEAN DEFAULT TRUE,
      email_notifications BOOLEAN DEFAULT TRUE,
      budget_cap NUMERIC DEFAULT 15000000,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_demands_status ON demands(status);
    CREATE INDEX IF NOT EXISTS idx_demands_municipality ON demands(municipality);
    CREATE INDEX IF NOT EXISTS idx_demands_uf ON demands(uf);
    CREATE INDEX IF NOT EXISTS idx_demands_created_at ON demands(created_at);
    CREATE INDEX IF NOT EXISTS idx_timeline_demand_id ON timeline_events(demand_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_demand_id ON attachments(demand_id);
  `);

  console.log('✅ Tabelas criadas/verificadas');
}

export default { query, get, all, run, initDatabase };
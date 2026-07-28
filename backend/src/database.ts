import pg, { PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida. Defina a variável de ambiente (Render: vínculo ao Postgres).');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
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

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'consulta' CHECK(role IN ('admin', 'gestor', 'analista', 'consulta', 'administrador', 'diretor', 'tecnico', 'parceiro', 'cliente', 'visitante')),
      active BOOLEAN DEFAULT TRUE,
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

    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_comments_demand_id ON comments(demand_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

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

    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      granted BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT NOT NULL CHECK(role IN ('admin', 'gestor', 'analista', 'consulta', 'administrador', 'diretor', 'tecnico', 'parceiro', 'cliente', 'visitante')),
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role, permission_id)
    );

    CREATE INDEX IF NOT EXISTS idx_demands_status ON demands(status);
    CREATE INDEX IF NOT EXISTS idx_demands_municipality ON demands(municipality);
    CREATE INDEX IF NOT EXISTS idx_demands_uf ON demands(uf);
    CREATE INDEX IF NOT EXISTS idx_demands_created_at ON demands(created_at);
    CREATE INDEX IF NOT EXISTS idx_timeline_demand_id ON timeline_events(demand_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_demand_id ON attachments(demand_id);

    -- Migrate role constraint for existing databases (idempotent)
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK(role IN ('admin', 'gestor', 'analista', 'consulta', 'administrador', 'diretor', 'tecnico', 'parceiro', 'cliente', 'visitante'));
    ALTER TABLE users ALTER COLUMN role SET DEFAULT 'consulta';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

    -- Expand role_permissions check constraint (idempotent)
    ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
    ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check
      CHECK(role IN ('admin', 'gestor', 'analista', 'consulta', 'administrador', 'diretor', 'tecnico', 'parceiro', 'cliente', 'visitante'));

    -- Add ano column to demands (idempotent)
    ALTER TABLE demands ADD COLUMN IF NOT EXISTS ano INTEGER DEFAULT EXTRACT(YEAR FROM NOW());

    CREATE TABLE IF NOT EXISTS token_blacklist (
      id SERIAL PRIMARY KEY,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);
    CREATE INDEX IF NOT EXISTS idx_token_blacklist_hash ON token_blacklist(token_hash);

    CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);

    -- ============================================================
    -- MÓDULO 1: Extended audit fields (idempotent)
    -- ============================================================
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

    -- ============================================================
    -- MÓDULO 2: Demand versioning
    -- ============================================================
    CREATE TABLE IF NOT EXISTS demand_versions (
      id SERIAL PRIMARY KEY,
      demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      changed_by INTEGER REFERENCES users(id),
      changed_by_name TEXT NOT NULL,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_demand_versions_demand_id ON demand_versions(demand_id);

    -- ============================================================
    -- MÓDULO 3: Password recovery
    -- ============================================================
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens(token_hash);

    -- ============================================================
    -- MÓDULO 5 & 12: Active sessions & inactivity
    -- ============================================================
    CREATE TABLE IF NOT EXISTS active_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      browser TEXT,
      os TEXT,
      last_activity TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ DEFAULT NOW(),
      active BOOLEAN DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON active_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_active_sessions_token ON active_sessions(token_hash);

    -- ============================================================
    -- MÓDULO 12: Login attempts (account lockout)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS login_attempts (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      ip_address TEXT,
      success BOOLEAN NOT NULL,
      attempted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempted_at);

    -- ============================================================
    -- MÓDULO 12: Password history (prevent reuse)
    -- ============================================================
    CREATE TABLE IF NOT EXISTS password_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id);

    -- ============================================================
    -- MÓDULO 1.1: Refresh tokens for JWT rotation
    -- ============================================================
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      family TEXT NOT NULL DEFAULT '',
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      replaced_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

    -- ============================================================
    -- Soft delete columns (idempotent)
    -- ============================================================
    ALTER TABLE demands ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

    -- ============================================================
    -- MÓDULO 7: Backup tracking
    -- ============================================================
    CREATE TABLE IF NOT EXISTS backups (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size BIGINT,
      sha256_hash TEXT NOT NULL,
      backup_type TEXT NOT NULL CHECK(backup_type IN ('daily', 'weekly', 'monthly', 'manual')),
      status TEXT DEFAULT 'completed' CHECK(status IN ('completed', 'failed', 'restoring')),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(backup_type);
    CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at);

    -- ============================================================
    -- MÓDULO 10: Export logs
    -- ============================================================
    CREATE TABLE IF NOT EXISTS export_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT NOT NULL,
      export_type TEXT NOT NULL CHECK(export_type IN ('pdf', 'excel')),
      record_count INTEGER DEFAULT 0,
      filters JSONB,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_export_logs_user ON export_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_export_logs_type ON export_logs(export_type);
    CREATE INDEX IF NOT EXISTS idx_export_logs_created ON export_logs(created_at);

    -- ============================================================
    -- MÓDULO 9: System monitoring
    -- ============================================================
    CREATE TABLE IF NOT EXISTS monitoring_logs (
      id SERIAL PRIMARY KEY,
      server_cpu REAL,
      server_memory REAL,
      api_response_time REAL,
      db_connection_count INTEGER,
      active_users INTEGER,
      total_demands INTEGER,
      last_backup_at TIMESTAMPTZ,
      integration_status TEXT,
      recorded_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_monitoring_logs_recorded ON monitoring_logs(recorded_at);
  `);

  console.log('✅ Tabelas criadas/verificadas');
}

export default { query, get, all, run, initDatabase };
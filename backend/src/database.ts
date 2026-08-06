import pg, { PoolClient } from 'pg';
import dotenv from 'dotenv';
import { logger } from './lib/logger.js';

dotenv.config();

if (!process.env.DATABASE_URL) {
  logger.error('❌ DATABASE_URL não definida. Defina a variável de ambiente (Render: vínculo ao Postgres).');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

function getSSLConfig(): any {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }
  if (process.env.DB_CA_CERT) {
    return { ca: process.env.DB_CA_CERT };
  }
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getSSLConfig(),
});

pool.on('error', (err) => {
  logger.error('Database pool error', { error: err instanceof Error ? err.message : err });
});

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
  // ... (mesmo conteúdo do original, mantido para compatibilidade)
  await run(`
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

    CREATE TABLE IF NOT EXISTS organs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_organs_name_upper ON organs (UPPER(name));

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

    -- Deadline recebido de sistemas externos (Fase 2.2) — idempotente para bancos já existentes
    ALTER TABLE demands ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ NULL;

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

    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK(role IN ('admin', 'gestor', 'analista', 'consulta', 'administrador', 'diretor', 'tecnico', 'parceiro', 'cliente', 'visitante'));
    ALTER TABLE users ALTER COLUMN role SET DEFAULT 'consulta';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

    ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
    ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check
      CHECK(role IN ('admin', 'gestor', 'analista', 'consulta', 'administrador', 'diretor', 'tecnico', 'parceiro', 'cliente', 'visitante'));

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

    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

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

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens(token_hash);

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

    CREATE TABLE IF NOT EXISTS password_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id);

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

    ALTER TABLE demands ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE demands ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id);
    ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id);
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS mime_type TEXT;
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0;
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS file_hash TEXT;
    CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(file_hash);

    ALTER TABLE demands ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
    ALTER TABLE municipalities ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
    ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
    ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'note';
    ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS details JSONB;
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id INTEGER DEFAULT 1;

    CREATE INDEX IF NOT EXISTS idx_demands_tenant ON demands(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_demands_deleted ON demands(deleted_at);

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

    CREATE TABLE IF NOT EXISTS export_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      user_name TEXT NOT NULL,
      export_type TEXT NOT NULL CHECK(export_type IN ('pdf', 'excel', 'csv')),
      record_count INTEGER DEFAULT 0,
      filters JSONB,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_export_logs_user ON export_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_export_logs_type ON export_logs(export_type);
    CREATE INDEX IF NOT EXISTS idx_export_logs_created ON export_logs(created_at);

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

    -- Módulo Integrações Governamentais (Fase 1 — webhooks)
    -- Segredos NÃO são armazenados no banco: a coluna secret_env_key referencia
    -- a variável de ambiente (ex.: TRANSFEREGOV_WEBHOOK_SECRET, SEI_WEBHOOK_SECRET, CGLOG_WEBHOOK_SECRET).
    CREATE TABLE IF NOT EXISTS integration_systems (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      secret_env_key TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      config JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      tenant_id INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id SERIAL PRIMARY KEY,
      system_id INTEGER NOT NULL REFERENCES integration_systems(id),
      system_code TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'unknown',
      idempotency_key TEXT UNIQUE NOT NULL,
      payload JSONB,
      headers JSONB,
      signature TEXT,
      received_ip TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'failed', 'unmatched', 'duplicate')),
      error TEXT,
      received_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      tenant_id INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_events_system ON webhook_events(system_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events(received_at);

    CREATE TABLE IF NOT EXISTS integration_logs (
      id SERIAL PRIMARY KEY,
      system_id INTEGER REFERENCES integration_systems(id),
      system_code TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'in' CHECK(direction IN ('in', 'out')),
      action TEXT NOT NULL,
      demand_id TEXT,
      webhook_event_id INTEGER REFERENCES webhook_events(id),
      status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success', 'warning', 'error')),
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      tenant_id INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_integration_logs_system ON integration_logs(system_id);
    CREATE INDEX IF NOT EXISTS idx_integration_logs_created ON integration_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_integration_logs_demand ON integration_logs(demand_id);

    CREATE TABLE IF NOT EXISTS demand_integrations (
      id SERIAL PRIMARY KEY,
      demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
      system_id INTEGER NOT NULL REFERENCES integration_systems(id),
      external_id TEXT,
      proposal_number TEXT,
      last_sync_at TIMESTAMPTZ,
      sync_status TEXT NOT NULL DEFAULT 'none' CHECK(sync_status IN ('none', 'pending', 'synced', 'error')),
      data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      tenant_id INTEGER DEFAULT 1,
      UNIQUE(demand_id, system_id)
    );
    CREATE INDEX IF NOT EXISTS idx_demand_integrations_proposal ON demand_integrations(proposal_number);
    CREATE INDEX IF NOT EXISTS idx_demand_integrations_external ON demand_integrations(external_id);
    CREATE INDEX IF NOT EXISTS idx_demand_integrations_system ON demand_integrations(system_id);

    -- Mapeamento configurável de status externo (Transferegov/SEI/CGLOG) -> status interno do SGD.
    -- internal_status restrito ao enum do SGD; regras podem ser desativadas sem excluir histórico.
    CREATE TABLE IF NOT EXISTS integration_status_mapping (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER DEFAULT 1,
      system_id INTEGER NOT NULL REFERENCES integration_systems(id),
      external_status TEXT NOT NULL,
      internal_status TEXT NOT NULL CHECK(internal_status IN ('analise', 'pendente', 'concluido', 'rejeitado')),
      description TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(system_id, external_status)
    );
    CREATE INDEX IF NOT EXISTS idx_integration_status_mapping_system ON integration_status_mapping(system_id);
    CREATE INDEX IF NOT EXISTS idx_integration_status_mapping_external ON integration_status_mapping(external_status);
    CREATE INDEX IF NOT EXISTS idx_integration_status_mapping_active ON integration_status_mapping(active);
  `);

  // Migração: unificar role 'administrador' → 'admin'
  await run("UPDATE users SET role = 'admin' WHERE role = 'administrador'");
  await run("DELETE FROM role_permissions WHERE role = 'administrador'");

  // Migração: padronização em CAIXA ALTA dos campos textuais das demandas.
  // Idempotente e segura: apenas registros divergentes são atualizados,
  // nenhuma informação é perdida (somente case/trim são alterados).
  await run(`
    UPDATE demands SET
      title = UPPER(TRIM(title)),
      description = UPPER(TRIM(description)),
      category = UPPER(TRIM(category)),
      municipality = UPPER(TRIM(municipality)),
      prefeitura = UPPER(TRIM(prefeitura)),
      organ = UPPER(TRIM(organ)),
      proposal_number = UPPER(TRIM(proposal_number)),
      responsible_name = UPPER(TRIM(responsible_name)),
      notes = UPPER(TRIM(notes))
    WHERE COALESCE(title, '') <> UPPER(TRIM(COALESCE(title, '')))
       OR COALESCE(description, '') <> UPPER(TRIM(COALESCE(description, '')))
       OR COALESCE(category, '') <> UPPER(TRIM(COALESCE(category, '')))
       OR COALESCE(municipality, '') <> UPPER(TRIM(COALESCE(municipality, '')))
       OR COALESCE(prefeitura, '') <> UPPER(TRIM(COALESCE(prefeitura, '')))
       OR COALESCE(organ, '') <> UPPER(TRIM(COALESCE(organ, '')))
       OR COALESCE(proposal_number, '') <> UPPER(TRIM(COALESCE(proposal_number, '')))
       OR COALESCE(responsible_name, '') <> UPPER(TRIM(COALESCE(responsible_name, '')))
       OR COALESCE(notes, '') <> UPPER(TRIM(COALESCE(notes, '')))
  `);
  // Migração: padronização em CAIXA ALTA dos municípios.
  // 1) Mescla duplicatas que diferem apenas por caixa no registro mais antigo
  //    (somando métricas — nenhuma informação é perdida);
  // 2) Remove as duplicatas (evita violação do UNIQUE(name, uf));
  // 3) Converte os nomes para CAIXA ALTA.
  await run(`
    UPDATE municipalities t SET
      demands_count = t.demands_count + d.demands_count,
      total_value = t.total_value + d.total_value,
      updated_at = NOW()
    FROM municipalities d
    WHERE d.id <> t.id
      AND d.uf = t.uf
      AND UPPER(TRIM(d.name)) = UPPER(TRIM(t.name))
      AND t.id IN (
        SELECT MIN(id) FROM municipalities
        GROUP BY uf, UPPER(TRIM(name))
        HAVING COUNT(*) > 1
      )
  `);
  await run(`
    DELETE FROM municipalities d
    USING municipalities b
    WHERE d.id > b.id
      AND d.uf = b.uf
      AND UPPER(TRIM(d.name)) = UPPER(TRIM(b.name))
  `);
  await run(`
    UPDATE municipalities SET name = UPPER(TRIM(name))
    WHERE COALESCE(name, '') <> UPPER(TRIM(COALESCE(name, '')))
  `);

  // Migração: inclui o tipo 'csv' na constraint de export_logs (idempotente).
  await run(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'export_logs_export_type_check'
          AND conrelid = 'export_logs'::regclass
      ) THEN
        ALTER TABLE export_logs DROP CONSTRAINT export_logs_export_type_check;
        ALTER TABLE export_logs
          ADD CONSTRAINT export_logs_export_type_check
          CHECK (export_type IN ('pdf', 'excel', 'csv'));
      END IF;
    END $$;
  `);

  logger.info('Tabelas criadas/verificadas');
}

export default { get, all, run, initDatabase };

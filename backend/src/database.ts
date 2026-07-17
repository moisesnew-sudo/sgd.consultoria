import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'sgd.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'viewer')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS municipalities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    uf TEXT NOT NULL,
    demands_count INTEGER DEFAULT 0,
    total_value REAL DEFAULT 0,
    schools_count INTEGER DEFAULT 0,
    population INTEGER DEFAULT 0,
    hdi REAL DEFAULT 0,
    region TEXT CHECK(region IN ('Norte', 'Nordeste', 'Sudeste', 'Sul', 'Centro-Oeste')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
    requested_value REAL DEFAULT 0,
    prefeitura TEXT,
    proposal_number TEXT,
    organ TEXT,
    process_link TEXT,
    responsible_name TEXT,
    responsible_email TEXT,
    responsible_phone TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS timeline_events (
    id TEXT PRIMARY KEY,
    demand_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    user_name TEXT NOT NULL,
    status_changed_to TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (demand_id) REFERENCES demands(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    demand_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size TEXT,
    type TEXT,
    file_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (demand_id) REFERENCES demands(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    sla_days_baixa INTEGER DEFAULT 45,
    sla_days_media INTEGER DEFAULT 30,
    sla_days_alta INTEGER DEFAULT 15,
    sla_days_urgente INTEGER DEFAULT 5,
    auto_triage BOOLEAN DEFAULT 1,
    email_notifications BOOLEAN DEFAULT 1,
    budget_cap REAL DEFAULT 15000000,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_demands_status ON demands(status);
  CREATE INDEX IF NOT EXISTS idx_demands_municipality ON demands(municipality);
  CREATE INDEX IF NOT EXISTS idx_demands_uf ON demands(uf);
  CREATE INDEX IF NOT EXISTS idx_demands_created_at ON demands(created_at);
  CREATE INDEX IF NOT EXISTS idx_timeline_demand_id ON timeline_events(demand_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_demand_id ON attachments(demand_id);
`);

// Migration: drop and recreate demands table if old status values exist
const demandCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='demands'").get() as any;
if (demandCheck && demandCheck.sql && (
  demandCheck.sql.includes("'triagem'") || 
  demandCheck.sql.includes("'analise_tecnica'") || 
  demandCheck.sql.includes("'em_andamento'") ||
  demandCheck.sql.includes("'cancelado'")
)) {
  console.log('🔄 Migrando banco de dados...');
  db.exec('DELETE FROM timeline_events');
  db.exec('DELETE FROM attachments');
  db.exec('DROP TABLE IF EXISTS demands');
  db.exec(`
    CREATE TABLE demands (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      status TEXT DEFAULT 'pendente' CHECK(status IN ('analise', 'pendente', 'concluido', 'rejeitado')),
      priority TEXT DEFAULT 'media' CHECK(priority IN ('baixa', 'media', 'alta', 'urgente')),
      municipality TEXT NOT NULL,
      uf TEXT NOT NULL,
      requested_value REAL DEFAULT 0,
      prefeitura TEXT,
      proposal_number TEXT,
      organ TEXT,
      process_link TEXT,
      responsible_name TEXT,
      responsible_email TEXT,
      responsible_phone TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_demands_status ON demands(status);
    CREATE INDEX IF NOT EXISTS idx_demands_municipality ON demands(municipality);
    CREATE INDEX IF NOT EXISTS idx_demands_uf ON demands(uf);
    CREATE INDEX IF NOT EXISTS idx_demands_created_at ON demands(created_at);
  `);
  console.log('✅ Migração concluída');
}

export default db;
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { get, all, run, transaction } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { logAudit, extractMeta } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { sanitizeColumnName } from '../lib/helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');

const router = Router();

if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

const SAFE_TABLES = ['demands', 'municipalities', 'timeline_events', 'attachments', 'comments', 'audit_logs'];

function validateTable(table: string): string {
  if (!SAFE_TABLES.includes(table)) {
    throw new Error(`Tabela não permitida: ${table}`);
  }
  return table;
}

async function exportAllData(tenantId: number): Promise<string> {
  const [demands, municipalities, timelineEvents, attachments, comments, auditLogs, users] = await Promise.all([
    all('SELECT * FROM demands WHERE tenant_id = $1', [tenantId]),
    all('SELECT * FROM municipalities WHERE tenant_id = $1', [tenantId]),
    all(
      `SELECT te.* FROM timeline_events te
       JOIN demands d ON d.id = te.demand_id
       WHERE d.tenant_id = $1`,
      [tenantId]
    ),
    all('SELECT * FROM attachments WHERE tenant_id = $1', [tenantId]),
    all('SELECT * FROM comments WHERE tenant_id = $1', [tenantId]),
    all('SELECT * FROM audit_logs WHERE tenant_id = $1', [tenantId]),
    all('SELECT id, email, name, role, active, created_at, updated_at, deleted_at, tenant_id FROM users WHERE tenant_id = $1', [tenantId])
  ]);
  const data: Record<string, any> = {
    demands, municipalities,
    timeline_events: timelineEvents,
    attachments, comments,
    audit_logs: auditLogs,
    users
  };

  return JSON.stringify({ version: 'sgd-v3', timestamp: new Date().toISOString(), data }, null, 2);
}

function safeFilePath(backupsDir: string, userPath: string): string {
  const resolved = path.resolve(backupsDir, userPath);
  if (!resolved.startsWith(path.resolve(backupsDir))) {
    throw new Error('Caminho de arquivo inválido');
  }
  return resolved;
}

router.get('/', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const backups = await all(
      `SELECT id, filename, file_size, sha256_hash, backup_type, status, created_by, created_at
       FROM backups WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [req.user!.tenant_id]
    );
    res.json(backups);
  } catch (error) {
    logger.error('List backups error:', error);
    res.status(500).json({ error: 'Erro ao listar backups' });
  }
});

router.post('/', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const backupType = req.body.type || 'manual';
    if (!['daily', 'weekly', 'monthly', 'manual'].includes(backupType)) {
      return res.status(400).json({ error: 'Tipo de backup inválido' });
    }
    const jsonData = await exportAllData(req.user!.tenant_id);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${backupType}_${timestamp}.json`;
    const filePath = path.join(BACKUPS_DIR, filename);
    const sha256Hash = crypto.createHash('sha256').update(jsonData).digest('hex');
    const fileSize = Buffer.byteLength(jsonData, 'utf8');

    fs.writeFileSync(filePath, jsonData, 'utf8');

    const result = await run(
      `INSERT INTO backups (filename, file_path, file_size, sha256_hash, backup_type, status, created_by, tenant_id)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7) RETURNING id`,
      [filename, filePath, fileSize, sha256Hash, backupType, req.user!.id, req.user!.tenant_id]
    );

    await logAudit({
      entity_type: 'backup', entity_id: String(result.rows[0].id), action: 'backup_created',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { type: backupType, filename, size: fileSize, sha256: sha256Hash },
      ip_address, user_agent
    });

    res.status(201).json({ id: result.rows[0].id, filename, file_size: fileSize, sha256_hash: sha256Hash, backup_type: backupType, status: 'completed', created_at: new Date().toISOString() });
  } catch (error) {
    logger.error('Create backup error:', error);
    res.status(500).json({ error: 'Erro ao criar backup' });
  }
});

router.get('/:id/download', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const backup = await get<{ file_path: string; filename: string }>(
      'SELECT file_path, filename FROM backups WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user!.tenant_id]
    );
    if (!backup) return res.status(404).json({ error: 'Backup não encontrado' });

    const resolvedPath = safeFilePath(BACKUPS_DIR, path.basename(backup.file_path));
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: 'Arquivo de backup não encontrado no disco' });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${backup.filename}`);
    res.sendFile(resolvedPath);
  } catch (error) {
    logger.error('Download backup error:', error);
    res.status(500).json({ error: 'Erro ao baixar backup' });
  }
});

router.post('/:id/verify', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const backup = await get<{ sha256_hash: string; file_path: string; filename: string }>(
      'SELECT sha256_hash, file_path, filename FROM backups WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user!.tenant_id]
    );
    if (!backup) return res.status(404).json({ error: 'Backup não encontrado' });

    const resolvedPath = safeFilePath(BACKUPS_DIR, path.basename(backup.file_path));
    if (!fs.existsSync(resolvedPath)) {
      return res.json({ valid: false, error: 'Arquivo de backup não encontrado no disco' });
    }
    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    const currentHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    const valid = currentHash === backup.sha256_hash;
    res.json({ valid, stored_hash: backup.sha256_hash, computed_hash: currentHash, filename: backup.filename });
  } catch (error) {
    logger.error('Verify backup error:', error);
    res.status(500).json({ error: 'Erro ao verificar backup' });
  }
});

router.post('/:id/restore', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const backup = await get<{ sha256_hash: string; file_path: string; filename: string }>(
      'SELECT sha256_hash, file_path, filename FROM backups WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user!.tenant_id]
    );
    if (!backup) return res.status(404).json({ error: 'Backup não encontrado' });

    const resolvedPath = safeFilePath(BACKUPS_DIR, path.basename(backup.file_path));
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: 'Arquivo de backup não encontrado no disco' });

    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    const currentHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    if (currentHash !== backup.sha256_hash) {
      return res.status(400).json({ error: 'Integridade do backup comprometida. O hash SHA-256 não corresponde. Restauração cancelada.' });
    }

    const backupData = JSON.parse(fileContent);
    if (!backupData.data) return res.status(400).json({ error: 'Formato de backup inválido' });
    const { data } = backupData;

    await transaction(async (client) => {
      await client.query('UPDATE active_sessions SET active = FALSE WHERE tenant_id = $1', [req.user!.tenant_id]);
      await client.query('DELETE FROM comments WHERE tenant_id = $1', [req.user!.tenant_id]);
      await client.query('DELETE FROM audit_logs WHERE tenant_id = $1', [req.user!.tenant_id]);
      await client.query('DELETE FROM attachments WHERE tenant_id = $1', [req.user!.tenant_id]);
      await client.query('DELETE FROM timeline_events WHERE demand_id IN (SELECT id FROM demands WHERE tenant_id = $1)', [req.user!.tenant_id]);
      await client.query('DELETE FROM demand_versions WHERE demand_id IN (SELECT id FROM demands WHERE tenant_id = $1)', [req.user!.tenant_id]);
      await client.query('DELETE FROM demands WHERE tenant_id = $1', [req.user!.tenant_id]);
      await client.query('DELETE FROM municipalities WHERE tenant_id = $1', [req.user!.tenant_id]);
      await client.query('DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)', [req.user!.tenant_id]);
      await client.query('DELETE FROM users WHERE tenant_id = $1', [req.user!.tenant_id]);

      for (const table of SAFE_TABLES.concat(['users'])) {
        if (data[table] && Array.isArray(data[table])) {
          for (const row of data[table]) {
            const cols = Object.keys(row).filter(k => {
              try { sanitizeColumnName(k); return true; } catch { return false; }
            });
            const vals = cols.map(c => row[c]);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            try {
              await client.query(`INSERT INTO ${validateTable(table)} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, vals);
            } catch { }
          }
        }
      }
    });

    await logAudit({
      entity_type: 'backup', entity_id: String(req.params.id), action: 'backup_restored',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { filename: backup.filename, tables_restored: Object.keys(data).filter(k => data[k]?.length).join(',') },
      ip_address, user_agent
    });

    res.json({ message: 'Backup restaurado com sucesso. Todas as sessões foram encerradas.' });
  } catch (error) {
    logger.error('Restore backup error:', error);
    res.status(500).json({ error: 'Erro ao restaurar backup' });
  }
});

export default router;

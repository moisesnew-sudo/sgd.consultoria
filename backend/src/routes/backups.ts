import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { get, all, run, transaction } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { logAudit, extractMeta } from '../lib/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');

const router = Router();

if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

async function exportAllData(): Promise<string> {
  // ✅ CORREÇÃO: Não exporta password_hash nem tokens sensíveis
  const data: Record<string, any> = {};
  const safeTables = ['demands', 'municipalities', 'timeline_events', 'attachments', 'comments', 'audit_logs', 'system_settings', 'permissions', 'user_permissions', 'role_permissions'];
  for (const table of safeTables) {
    const rows = await all(`SELECT * FROM ${table}`);
    data[table] = rows;
  }
  // Usuários sem password_hash
  const users = await all('SELECT id, email, name, role, active, created_at, updated_at, deleted_at FROM users');
  data['users'] = users;

  return JSON.stringify({ version: 'sgd-v3', timestamp: new Date().toISOString(), data }, null, 2);
}

router.get('/', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const backups = await all(
      `SELECT id, filename, file_size, sha256_hash, backup_type, status, created_by, created_at
       FROM backups ORDER BY created_at DESC`
    );
    res.json(backups);
  } catch (error) {
    console.error('List backups error:', error);
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
    const jsonData = await exportAllData();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${backupType}_${timestamp}.json`;
    const filePath = path.join(BACKUPS_DIR, filename);
    const sha256Hash = crypto.createHash('sha256').update(jsonData).digest('hex');
    const fileSize = Buffer.byteLength(jsonData, 'utf8');

    fs.writeFileSync(filePath, jsonData, 'utf8');

    const result = await run(
      `INSERT INTO backups (filename, file_path, file_size, sha256_hash, backup_type, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6) RETURNING id`,
      [filename, filePath, fileSize, sha256Hash, backupType, req.user!.id]
    );

    await logAudit({
      entity_type: 'backup', entity_id: String(result.rows[0].id), action: 'backup_created',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { type: backupType, filename, size: fileSize, sha256: sha256Hash },
      ip_address, user_agent
    });

    res.status(201).json({ id: result.rows[0].id, filename, file_size: fileSize, sha256_hash: sha256Hash, backup_type: backupType, status: 'completed', created_at: new Date().toISOString() });
  } catch (error) {
    console.error('Create backup error:', error);
    res.status(500).json({ error: 'Erro ao criar backup' });
  }
});

router.get('/:id/download', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const backup = await get<{ file_path: string; filename: string }>(
      'SELECT file_path, filename FROM backups WHERE id = $1', [req.params.id]
    );
    if (!backup) return res.status(404).json({ error: 'Backup não encontrado' });
    if (!fs.existsSync(backup.file_path)) return res.status(404).json({ error: 'Arquivo de backup não encontrado no disco' });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${backup.filename}`);
    res.sendFile(backup.file_path);
  } catch (error) {
    console.error('Download backup error:', error);
    res.status(500).json({ error: 'Erro ao baixar backup' });
  }
});

router.post('/:id/verify', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const backup = await get<{ sha256_hash: string; file_path: string; filename: string }>(
      'SELECT sha256_hash, file_path, filename FROM backups WHERE id = $1', [req.params.id]
    );
    if (!backup) return res.status(404).json({ error: 'Backup não encontrado' });
    if (!fs.existsSync(backup.file_path)) {
      return res.json({ valid: false, error: 'Arquivo de backup não encontrado no disco' });
    }
    const fileContent = fs.readFileSync(backup.file_path, 'utf8');
    const currentHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    const valid = currentHash === backup.sha256_hash;
    res.json({ valid, stored_hash: backup.sha256_hash, computed_hash: currentHash, filename: backup.filename });
  } catch (error) {
    console.error('Verify backup error:', error);
    res.status(500).json({ error: 'Erro ao verificar backup' });
  }
});

router.post('/:id/restore', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const backup = await get<{ sha256_hash: string; file_path: string; filename: string }>(
      'SELECT sha256_hash, file_path, filename FROM backups WHERE id = $1', [req.params.id]
    );
    if (!backup) return res.status(404).json({ error: 'Backup não encontrado' });
    if (!fs.existsSync(backup.file_path)) return res.status(404).json({ error: 'Arquivo de backup não encontrado no disco' });

    const fileContent = fs.readFileSync(backup.file_path, 'utf8');
    const currentHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    if (currentHash !== backup.sha256_hash) {
      return res.status(400).json({ error: 'Integridade do backup comprometida. O hash SHA-256 não corresponde. Restauração cancelada.' });
    }

    const backupData = JSON.parse(fileContent);
    if (!backupData.data) return res.status(400).json({ error: 'Formato de backup inválido' });
    const { data } = backupData;

    await transaction(async (client) => {
      await client.query('UPDATE active_sessions SET active = FALSE');
      await client.query('DELETE FROM comments');
      await client.query('DELETE FROM audit_logs');
      await client.query('DELETE FROM attachments');
      await client.query('DELETE FROM timeline_events');
      await client.query('DELETE FROM demand_versions');
      await client.query('DELETE FROM token_blacklist');
      await client.query('DELETE FROM demands');
      await client.query('DELETE FROM municipalities');
      await client.query('DELETE FROM user_permissions');
      await client.query('DELETE FROM role_permissions');
      await client.query('DELETE FROM permissions');
      await client.query('DELETE FROM users');
      await client.query('DELETE FROM system_settings');

      for (const table of ['permissions', 'users', 'system_settings', 'municipalities', 'demands', 'timeline_events', 'attachments', 'comments', 'user_permissions', 'role_permissions', 'audit_logs']) {
        if (data[table] && Array.isArray(data[table])) {
          for (const row of data[table]) {
            const cols = Object.keys(row);
            const vals = Object.values(row);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            try {
              await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, vals);
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
    console.error('Restore backup error:', error);
    res.status(500).json({ error: 'Erro ao restaurar backup' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { get, all, run, transaction } from '../database.js';
import { authenticateToken, requireRole, requirePermission } from '../middleware/auth.js';
import { logAudit, logExport, extractMeta } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { buildUpdateQuery, sanitizeColumnName } from '../lib/helpers.js';

const router = Router();

const settingsSchema = z.object({
  organization_name: z.string().optional(),
  primary_color: z.string().optional(),
  accent_color: z.string().optional(),
  logo_url: z.string().optional(),
  sla_days_baixa: z.number().min(1).optional(),
  sla_days_media: z.number().min(1).optional(),
  sla_days_alta: z.number().min(1).optional(),
  sla_days_urgente: z.number().min(1).optional(),
  auto_triage: z.boolean().optional(),
  email_notifications: z.boolean().optional(),
  budget_cap: z.number().positive().optional()
});

const importSchema = z.object({
  version: z.string(),
  timestamp: z.string(),
  data: z.object({
    demands: z.array(z.any()),
    municipalities: z.array(z.any()),
    settings: z.object({}).passthrough().optional(),
    users: z.array(z.any()).optional(),
    timeline: z.array(z.any()).optional(),
    attachments: z.array(z.any()).optional(),
    comments: z.array(z.any()).optional(),
    audit: z.array(z.any()).optional(),
  })
});

const SAFE_IMPORT_TABLES = ['permissions', 'users', 'system_settings', 'municipalities', 'demands', 'timeline_events', 'attachments', 'comments', 'user_permissions', 'role_permissions', 'audit_logs'];

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    let settings = await get('SELECT * FROM system_settings WHERE id = 1');
    if (!settings) {
      await run(`INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
      settings = await get('SELECT * FROM system_settings WHERE id = 1');
    }
    res.json(settings);
  } catch (error) {
    logger.error('Get settings error:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

router.put('/', authenticateToken, requireRole('admin'), requirePermission('settings.edit'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const data = settingsSchema.parse(req.body);
    await run(`INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    const result = buildUpdateQuery('system_settings', data, 'id', 1);
    if (result) {
      await run(result.sql, result.values);
    }
    const updated = await get('SELECT * FROM system_settings WHERE id = 1');
    await logAudit({
      entity_type: 'settings', entity_id: '1', action: 'update',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { changed: Object.keys(data) }, ip_address, user_agent
    });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    logger.error('Update settings error:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

router.get('/export', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const demands = await all('SELECT * FROM demands');
    const municipalities = await all('SELECT * FROM municipalities');
    const settings = await get('SELECT * FROM system_settings WHERE id = 1');
    const users = await all('SELECT id, email, name, role, active, created_at FROM users');
    const timeline = await all('SELECT * FROM timeline_events');
    const attachments = await all('SELECT * FROM attachments');
    const comments = await all('SELECT * FROM comments');
    const audit = await all('SELECT * FROM audit_logs');

    const exportData = {
      version: 'sgd-v2',
      timestamp: new Date().toISOString(),
      data: { demands, municipalities, settings, users, timeline, attachments, comments, audit }
    };
    await logExport(req, req.user!, 'csv', demands.length, { type: 'full_backup' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=SGD_Backup_${new Date().toISOString().split('T')[0]}.json`);
    res.json(exportData);
  } catch (error) {
    logger.error('Export error:', error);
    res.status(500).json({ error: 'Erro ao exportar dados' });
  }
});

router.post('/import', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { data } = req.body;

    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Formato de backup inválido', details: parsed.error.errors });
    }

    const providedHash = req.headers['x-backup-hash'] as string;
    if (providedHash) {
      const computedHash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
      if (computedHash !== providedHash) {
        return res.status(400).json({ error: 'Hash de integridade do backup não corresponde' });
      }
    }

    const backupTables = ['comments', 'audit_logs', 'attachments', 'timeline_events', 'demands', 'municipalities', 'users', 'system_settings'];
    const preBackup: Record<string, any[]> = {};
    for (const table of backupTables) {
      preBackup[table] = await all(`SELECT * FROM ${table}`);
    }

    await transaction(async (client) => {
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

      for (const table of SAFE_IMPORT_TABLES) {
        if (data[table] && Array.isArray(data[table])) {
          for (const row of data[table]) {
            const cols = Object.keys(row).filter(k => {
              try { sanitizeColumnName(k); return true; } catch { return false; }
            });
            const vals = cols.map(c => row[c]);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            try {
              await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, vals);
            } catch { }
          }
        }
      }
    });

    await logAudit({
      entity_type: 'settings', entity_id: 'import', action: 'import',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { tables: Object.keys(data).filter(k => data[k]?.length).join(',') }
    });

    res.json({ message: 'Dados importados com sucesso' });
  } catch (error) {
    logger.error('Import error:', error);
    res.status(500).json({ error: 'Erro ao importar dados' });
  }
});

export default router;

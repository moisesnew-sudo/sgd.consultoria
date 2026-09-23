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

// C1: estruturas globais de RBAC NUNCA são importáveis via backup de tenant.
const GLOBAL_RBAC_KEYS = ['permissions', 'user_permissions', 'role_permissions'];
const SAFE_IMPORT_TABLES = ['users', 'system_settings', 'municipalities', 'demands', 'timeline_events', 'attachments', 'comments', 'audit_logs'];

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenant_id;
    let settings = await get('SELECT * FROM system_settings WHERE tenant_id = $1', [tenantId]);
    if (!settings) {
      await run(`INSERT INTO system_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
      settings = await get('SELECT * FROM system_settings WHERE tenant_id = $1', [tenantId]);
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
    const tenantId = req.user!.tenant_id;
    const data = settingsSchema.parse(req.body);
    await run(`INSERT INTO system_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
    const result = buildUpdateQuery('system_settings', data, 'tenant_id', tenantId);
    if (result) {
      await run(result.sql, result.values);
    }
    const updated = await get('SELECT * FROM system_settings WHERE tenant_id = $1', [tenantId]);
    await logAudit({
      entity_type: 'settings', entity_id: String(tenantId), action: 'update',
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
    const tenantId = req.user!.tenant_id;
    const demands = await all('SELECT * FROM demands WHERE tenant_id = $1', [tenantId]);
    const municipalities = await all('SELECT * FROM municipalities WHERE tenant_id = $1', [tenantId]);
    const settings = await get('SELECT * FROM system_settings WHERE tenant_id = $1', [tenantId]);
    const users = await all('SELECT id, email, name, role, active, created_at FROM users WHERE tenant_id = $1', [tenantId]);
    const timeline = await all(
      `SELECT te.* FROM timeline_events te
       JOIN demands d ON d.id = te.demand_id
       WHERE d.tenant_id = $1`,
      [tenantId]
    );
    const attachments = await all('SELECT * FROM attachments WHERE tenant_id = $1', [tenantId]);
    const comments = await all('SELECT * FROM comments WHERE tenant_id = $1', [tenantId]);
    const audit = await all('SELECT * FROM audit_logs WHERE tenant_id = $1', [tenantId]);

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

    // C1: rejeita estruturas globais de RBAC ANTES de qualquer parse/transação.
    const g = req.body?.data;
    if (g && typeof g === 'object') {
      const blocked = GLOBAL_RBAC_KEYS.filter(k => Array.isArray(g[k]) && g[k].length > 0);
      if (blocked.length > 0) {
        return res.status(403).json({ error: `Importação de estruturas globais de RBAC não permitida: ${blocked.join(', ')}` });
      }
    }

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
    const TENANT_SCOPED = new Set(['comments', 'audit_logs', 'attachments', 'timeline_events', 'demands', 'municipalities', 'users', 'system_settings']);
    const tenantId = req.user!.tenant_id;
    const preBackup: Record<string, any[]> = {};
    for (const table of backupTables) {
      preBackup[table] = await all(`SELECT * FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }

    await transaction(async (client) => {
      await client.query('UPDATE active_sessions SET active = FALSE WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM comments WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM audit_logs WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM attachments WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM timeline_events WHERE demand_id IN (SELECT id FROM demands WHERE tenant_id = $1)', [tenantId]);
      await client.query('DELETE FROM demand_versions WHERE demand_id IN (SELECT id FROM demands WHERE tenant_id = $1)', [tenantId]);
      await client.query('DELETE FROM demands WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM municipalities WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)', [tenantId]);
      await client.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
      await client.query('DELETE FROM system_settings WHERE tenant_id = $1', [tenantId]);

      for (const table of SAFE_IMPORT_TABLES) {
        if (data[table] && Array.isArray(data[table])) {
          const scoped = TENANT_SCOPED.has(table);
          for (const row of data[table]) {
            const cols = Object.keys(row).filter(k => {
              try { sanitizeColumnName(k); return true; } catch { return false; }
            }).filter(k => !(scoped && k === 'tenant_id'));
            const vals = cols.map(c => row[c]);
            if (scoped) { cols.push('tenant_id'); vals.push(tenantId); }
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            try {
              await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, vals);
            } catch { }
          }
        }
      }

      // Backup legítimo v2 exporta `settings` como OBJETO único do tenant.
      // Backups legados podem conter `id` (PK antiga removida): ignorado abaixo, nunca inserido.
      if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
        const row = data.settings;
        const cols = Object.keys(row).filter(k => {
          try { sanitizeColumnName(k); return true; } catch { return false; }
        }).filter(k => k.toLowerCase() !== 'tenant_id' && k.toLowerCase() !== 'id');
        if (cols.length > 0) {
          const vals = cols.map(c => row[c]);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO system_settings (${cols.join(', ')}, tenant_id) VALUES (${placeholders}, $${cols.length + 1}) ON CONFLICT (tenant_id) DO UPDATE SET ${cols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`,
            [...vals, tenantId]
          );
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

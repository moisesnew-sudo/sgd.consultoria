import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { get, all, run } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

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

router.get('/', async (req: Request, res: Response) => {
  try {
    let settings = await get('SELECT * FROM system_settings WHERE id = 1');
    if (!settings) {
      await run(`INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
      settings = await get('SELECT * FROM system_settings WHERE id = 1');
    }
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

router.put('/', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const data = settingsSchema.parse(req.body);
    await run(`INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${col} = $${idx++}`);
        values.push(value);
      }
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      values.push(1);
      await run(`UPDATE system_settings SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }

    const updated = await get('SELECT * FROM system_settings WHERE id = 1');
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    console.error('Update settings error:', error);
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
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=SGD_Backup_${new Date().toISOString().split('T')[0]}.json`);
    res.json(exportData);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Erro ao exportar dados' });
  }
});

router.post('/import', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { data } = req.body;
    if (!data || !data.demands || !data.municipalities || !data.settings) {
      return res.status(400).json({ error: 'Formato de backup inválido' });
    }

    await run('DELETE FROM comments');
    await run('DELETE FROM audit_logs');
    await run('DELETE FROM attachments');
    await run('DELETE FROM timeline_events');
    await run('DELETE FROM demands');
    await run('DELETE FROM municipalities');
    await run('DELETE FROM users');
    await run('DELETE FROM system_settings');

    for (const m of data.municipalities) {
      await run(
        `INSERT INTO municipalities (id, name, uf, demands_count, total_value, schools_count, population, hdi, region)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [m.id, m.name, m.uf, m.demands_count, m.total_value, m.schools_count, m.population, m.hdi, m.region]
      );
    }

    for (const d of data.demands) {
      await run(
        `INSERT INTO demands (id, title, description, category, status, priority, municipality, uf, requested_value, prefeitura, proposal_number, organ, process_link, responsible_name, responsible_email, responsible_phone, notes, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
        [d.id, d.title, d.description, d.category, d.status, d.priority, d.municipality, d.uf, d.requested_value,
         d.prefeitura, d.proposal_number, d.organ, d.process_link, d.responsible_name, d.responsible_email,
         d.responsible_phone, d.notes, d.created_by, d.created_at, d.updated_at]
      );
    }

    const s = data.settings;
    await run(
      `INSERT INTO system_settings (id, sla_days_baixa, sla_days_media, sla_days_alta, sla_days_urgente, auto_triage, email_notifications, budget_cap, organization_name, primary_color, accent_color, logo_url)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO UPDATE SET sla_days_baixa = EXCLUDED.sla_days_baixa`,
      [s.sla_days_baixa, s.sla_days_media, s.sla_days_alta, s.sla_days_urgente,
       s.auto_triage, s.email_notifications, s.budget_cap, s.organization_name || null,
       s.primary_color || null, s.accent_color || null, s.logo_url || null]
    );

    for (const u of (data.users || [])) {
      await run(
        `INSERT INTO users (id, email, password, name, role, active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
        [u.id, u.email, u.password || 'senha-reset-123', u.name, u.role, u.active ?? true, u.created_at]
      );
    }

    for (const t of (data.timeline || [])) {
      await run(
        `INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
        [t.id, t.demand_id, t.title, t.description, t.user_name, t.status_changed_to, t.created_at]
      );
    }

    for (const a of (data.attachments || [])) {
      await run(
        `INSERT INTO attachments (id, demand_id, name, size, type, uploaded_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [a.id, a.demand_id, a.name, a.size, a.type, a.uploaded_by, a.created_at]
      );
    }

    for (const c of (data.comments || [])) {
      await run(
        `INSERT INTO comments (id, demand_id, user_id, user_name, body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
        [c.id, c.demand_id, c.user_id, c.user_name, c.body, c.created_at]
      );
    }

    for (const al of (data.audit || [])) {
      await run(
        `INSERT INTO audit_logs (id, entity_type, entity_id, action, user_id, user_name, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO UPDATE SET action = EXCLUDED.action`,
        [al.id, al.entity_type, al.entity_id, al.action, al.user_id, al.user_name, al.details, al.created_at]
      );
    }

    res.json({ message: 'Dados importados com sucesso' });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Erro ao importar dados' });
  }
});

export default router;
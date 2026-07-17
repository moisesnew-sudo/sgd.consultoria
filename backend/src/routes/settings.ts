import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../database.js';
import { SystemSettings } from '../types.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

const settingsSchema = z.object({
  sla_days_baixa: z.number().min(1).optional(),
  sla_days_media: z.number().min(1).optional(),
  sla_days_alta: z.number().min(1).optional(),
  sla_days_urgente: z.number().min(1).optional(),
  auto_triage: z.boolean().optional(),
  email_notifications: z.boolean().optional(),
  budget_cap: z.number().positive().optional()
});

// Get settings
router.get('/', (req: Request, res: Response) => {
  try {
    let settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() as SystemSettings | undefined;

    if (!settings) {
      // Create default settings
      db.prepare(`
        INSERT INTO system_settings (id, sla_days_baixa, sla_days_media, sla_days_alta, sla_days_urgente, auto_triage, email_notifications, budget_cap)
        VALUES (1, 45, 30, 15, 5, 1, 1, 15000000)
      `).run();

      settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() as SystemSettings;
    }

    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

// Update settings (admin only)
router.put('/', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const data = settingsSchema.parse(req.body);

    // Ensure settings exist
    const existing = db.prepare('SELECT id FROM system_settings WHERE id = 1').get();

    if (!existing) {
      db.prepare(`
        INSERT INTO system_settings (id) VALUES (1)
      `).run();
    }

    // Update only provided fields
    const updates: string[] = [];
    const values: any[] = [];

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    });

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(1); // id = 1

      db.prepare(`UPDATE system_settings SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

// Export all data (admin only)
router.get('/export', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const demands = db.prepare('SELECT * FROM demands').all();
    const municipalities = db.prepare('SELECT * FROM municipalities').all();
    const settings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
    const users = db.prepare('SELECT id, email, name, role, created_at FROM users').all();

    const exportData = {
      version: 'sgd-v2',
      timestamp: new Date().toISOString(),
      data: {
        demands,
        municipalities,
        settings,
        users
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=SGD_Backup_${new Date().toISOString().split('T')[0]}.json`);
    res.json(exportData);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Erro ao exportar dados' });
  }
});

// Import data (admin only)
router.post('/import', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { data } = req.body;

    if (!data || !data.demands || !data.municipalities || !data.settings) {
      return res.status(400).json({ error: 'Formato de backup inválido' });
    }

    // Transaction for atomic import
    const transaction = db.transaction(() => {
      // Clear existing data
      db.prepare('DELETE FROM attachments').run();
      db.prepare('DELETE FROM timeline_events').run();
      db.prepare('DELETE FROM demands').run();
      db.prepare('DELETE FROM municipalities').run();
      db.prepare('DELETE FROM system_settings').run();

      // Import municipalities
      const insertMunicipality = db.prepare(`
        INSERT OR REPLACE INTO municipalities (id, name, uf, demands_count, total_value, schools_count, population, hdi, region)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const m of data.municipalities) {
        insertMunicipality.run(
          m.id, m.name, m.uf, m.demands_count, m.total_value,
          m.schools_count, m.population, m.hdi, m.region
        );
      }

      // Import demands
      const insertDemand = db.prepare(`
        INSERT OR REPLACE INTO demands (
          id, title, description, category, status, priority,
          municipality, uf, requested_value, prefeitura, proposal_number,
          organ, process_link, responsible_name, responsible_email,
          responsible_phone, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const d of data.demands) {
        insertDemand.run(
          d.id, d.title, d.description, d.category, d.status, d.priority,
          d.municipality, d.uf, d.requested_value, d.prefeitura, d.proposal_number,
          d.organ, d.process_link, d.responsible_name, d.responsible_email,
          d.responsible_phone, d.notes, d.created_by, d.created_at, d.updated_at
        );
      }

      // Import settings
      const s = data.settings;
      db.prepare(`
        INSERT OR REPLACE INTO system_settings (id, sla_days_baixa, sla_days_media, sla_days_alta, sla_days_urgente, auto_triage, email_notifications, budget_cap)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        s.sla_days_baixa, s.sla_days_media, s.sla_days_alta, s.sla_days_urgente,
        s.auto_triage ? 1 : 0, s.email_notifications ? 1 : 0, s.budget_cap
      );
    });

    transaction();

    res.json({ message: 'Dados importados com sucesso' });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Erro ao importar dados' });
  }
});

export default router;
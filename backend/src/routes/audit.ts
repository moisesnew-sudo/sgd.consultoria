import { Router, Request, Response } from 'express';
import { get, all } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

// List audit logs (admin only). Optional ?entity_type=&entity_id=
router.get('/', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id, limit } = req.query;
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];
    if (entity_type) { sql += ` AND entity_type = $${params.length + 1}`; params.push(entity_type); }
    if (entity_id) { sql += ` AND entity_id = $${params.length + 1}`; params.push(entity_id); }
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(Math.min(Number(limit) || 100, 500));
    const logs = await all(sql, params);
    res.json(logs);
  } catch (e) {
    console.error('Audit list error:', e);
    res.status(500).json({ error: 'Erro ao listar logs' });
  }
});

// Comments count per demand (used by notifications)
router.get('/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const total = await get<{ count: string }>('SELECT COUNT(*) as count FROM audit_logs');
    res.json({ total: parseInt(total?.count || '0') });
  } catch (e) {
    console.error('Audit stats error:', e);
    res.status(500).json({ error: 'Erro ao obter estatísticas' });
  }
});

export default router;

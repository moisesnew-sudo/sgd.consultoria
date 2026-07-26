import { Router, Request, Response } from 'express';
import { get, all, run } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { extractMeta } from '../lib/audit.js';

const router = Router();

router.get('/', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id, action, user_id, start_date, end_date, page = '1', limit = '100' } = req.query;
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];
    if (entity_type) { sql += ` AND entity_type = $${params.length + 1}`; params.push(entity_type); }
    if (entity_id) { sql += ` AND entity_id = $${params.length + 1}`; params.push(entity_id); }
    if (action) { sql += ` AND action = $${params.length + 1}`; params.push(action); }
    if (user_id) { sql += ` AND user_id = $${params.length + 1}`; params.push(parseInt(user_id as string)); }
    if (start_date) { sql += ` AND created_at >= $${params.length + 1}`; params.push(start_date); }
    if (end_date) { sql += ` AND created_at <= $${params.length + 1}`; params.push(end_date); }

    const countResult = await get<{ count: string }>(sql.replace('SELECT *', 'SELECT COUNT(*) as count'), params);
    const total = parseInt(countResult?.count || '0');
    const p = Math.max(1, parseInt(page as string));
    const l = Math.min(parseInt(limit as string), 500);
    const offset = (p - 1) * l;
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(l, offset);

    const logs = await all(sql, params);
    res.json({ data: logs, pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) } });
  } catch (e) {
    console.error('Audit list error:', e);
    res.status(500).json({ error: 'Erro ao listar logs' });
  }
});

router.get('/dashboard-stats', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;
    const dateFilter = start_date && end_date
      ? ` AND created_at >= '${start_date}' AND created_at <= '${end_date}'`
      : '';

    const totalLogins = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE action = 'login'${dateFilter}`
    );
    const failedLogins = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE action IN ('login_failed', 'login_locked')${dateFilter}`
    );
    const activeUsers = await get<{ count: string }>(
      "SELECT COUNT(*) as count FROM users WHERE active = TRUE"
    );
    const activeSessions = await get<{ count: string }>(
      "SELECT COUNT(*) as count FROM active_sessions WHERE active = TRUE AND last_activity > NOW() - INTERVAL '30 minutes'"
    );
    const pdfExports = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM export_logs WHERE export_type = 'pdf'${dateFilter.replace('created_at', 'export_logs.created_at')}`
    );
    const excelExports = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM export_logs WHERE export_type = 'excel'${dateFilter.replace('created_at', 'export_logs.created_at')}`
    );
    const demandsCreated = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE action = 'create' AND entity_type = 'demand'${dateFilter}`
    );
    const demandsUpdated = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE action = 'update' AND entity_type = 'demand'${dateFilter}`
    );
    const demandsDeleted = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE action = 'delete' AND entity_type = 'demand'${dateFilter}`
    );
    const permChanges = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE action LIKE 'permission%'${dateFilter}`
    );
    const userChanges = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE action IN ('create', 'update') AND entity_type = 'user'${dateFilter}`
    );

    const loginsByDay = await all<{ day: string; count: string }>(
      `SELECT DATE(created_at) as day, COUNT(*) as count FROM audit_logs WHERE action = 'login'${dateFilter ? dateFilter.replace('created_at', 'audit_logs.created_at') : ''} GROUP BY day ORDER BY day DESC LIMIT 30`
    );
    const changesByUser = await all<{ user_name: string; count: string }>(
      `SELECT user_name, COUNT(*) as count FROM audit_logs WHERE action IN ('create', 'update', 'delete') ${dateFilter} GROUP BY user_name ORDER BY count DESC LIMIT 10`
    );
    const demandsModified = await all<{ day: string; count: string }>(
      `SELECT DATE(created_at) as day, COUNT(*) as count FROM audit_logs WHERE entity_type = 'demand'${dateFilter ? dateFilter.replace('created_at', 'audit_logs.created_at') : ''} GROUP BY day ORDER BY day DESC LIMIT 30`
    );
    const exportsDone = await all<{ day: string; count: string }>(
      `SELECT DATE(created_at) as day, COUNT(*) as count FROM export_logs${dateFilter ? ` WHERE created_at >= '${start_date}' AND created_at <= '${end_date}'` : ''} GROUP BY day ORDER BY day DESC LIMIT 30`
    );

    res.json({
      total_logins: parseInt(totalLogins?.count || '0'),
      failed_logins: parseInt(failedLogins?.count || '0'),
      active_users: parseInt(activeUsers?.count || '0'),
      active_sessions: parseInt(activeSessions?.count || '0'),
      pdf_exports: parseInt(pdfExports?.count || '0'),
      excel_exports: parseInt(excelExports?.count || '0'),
      demands_created: parseInt(demandsCreated?.count || '0'),
      demands_updated: parseInt(demandsUpdated?.count || '0'),
      demands_deleted: parseInt(demandsDeleted?.count || '0'),
      permission_changes: parseInt(permChanges?.count || '0'),
      user_changes: parseInt(userChanges?.count || '0'),
      logins_by_day: loginsByDay,
      changes_by_user: changesByUser,
      demands_modified: demandsModified,
      exports_done: exportsDone
    });
  } catch (e) {
    console.error('Audit dashboard stats error:', e);
    res.status(500).json({ error: 'Erro ao carregar estatísticas' });
  }
});

router.post('/log-export', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { ip_address } = extractMeta(req);
    const { export_type, record_count, filters } = req.body;
    if (!['pdf', 'excel'].includes(export_type)) {
      return res.status(400).json({ error: 'Tipo de exportação inválido' });
    }
    await run(
      'INSERT INTO export_logs (user_id, user_name, export_type, record_count, filters, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user!.id, req.user!.name, export_type, record_count || 0, filters ? JSON.stringify(filters) : null, ip_address]
    );
    res.json({ message: 'Exportação registrada' });
  } catch (error) {
    console.error('Log export error:', error);
    res.status(500).json({ error: 'Erro ao registrar exportação' });
  }
});

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

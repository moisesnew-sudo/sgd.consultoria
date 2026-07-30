import { Router, Request, Response } from 'express';
import { get, all, run } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { extractMeta, logExport } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

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
    logger.error('Audit list error:', e);
    res.status(500).json({ error: 'Erro ao listar logs' });
  }
});

router.get('/dashboard-stats', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;

    const dp = (() => {
      const params: any[] = [];
      let clause = '';
      if (start_date) { clause += ` AND created_at >= $${params.length + 1}`; params.push(start_date); }
      if (end_date) { clause += ` AND created_at <= $${params.length + 1}`; params.push(end_date); }
      return { clause, params } as const;
    })();

    const [totalLogins, failedLogins, activeUsers, activeSessions, pdfExports, excelExports, demandsCreated, demandsUpdated, demandsDeleted, permChanges, userChanges] = await Promise.all([
      get<{ count: string }>("SELECT COUNT(*) as count FROM audit_logs WHERE action = 'login'" + dp.clause, dp.params).then(r => parseInt(r?.count || '0')),
      get<{ count: string }>("SELECT COUNT(*) as count FROM audit_logs WHERE action IN ('login_failed', 'login_locked')" + dp.clause, dp.params).then(r => parseInt(r?.count || '0')),
      get<{ count: string }>("SELECT COUNT(*) as count FROM users WHERE active = TRUE"),
      get<{ count: string }>("SELECT COUNT(*) as count FROM active_sessions WHERE active = TRUE AND last_activity > NOW() - INTERVAL '30 minutes'"),
      (async () => {
        const p: any[] = ['pdf'];
        let sql = "SELECT COUNT(*) as count FROM export_logs WHERE export_type = $1";
        if (start_date) { sql += ` AND created_at >= $${p.length + 1}`; p.push(start_date); }
        if (end_date) { sql += ` AND created_at <= $${p.length + 1}`; p.push(end_date); }
        const r = await get<{ count: string }>(sql, p); return parseInt(r?.count || '0');
      })(),
      (async () => {
        const p: any[] = ['excel'];
        let sql = "SELECT COUNT(*) as count FROM export_logs WHERE export_type = $1";
        if (start_date) { sql += ` AND created_at >= $${p.length + 1}`; p.push(start_date); }
        if (end_date) { sql += ` AND created_at <= $${p.length + 1}`; p.push(end_date); }
        const r = await get<{ count: string }>(sql, p); return parseInt(r?.count || '0');
      })(),
      get<{ count: string }>("SELECT COUNT(*) as count FROM audit_logs WHERE action = 'create' AND entity_type = 'demand'" + dp.clause, dp.params).then(r => parseInt(r?.count || '0')),
      get<{ count: string }>("SELECT COUNT(*) as count FROM audit_logs WHERE action = 'update' AND entity_type = 'demand'" + dp.clause, dp.params).then(r => parseInt(r?.count || '0')),
      get<{ count: string }>("SELECT COUNT(*) as count FROM audit_logs WHERE action = 'delete' AND entity_type = 'demand'" + dp.clause, dp.params).then(r => parseInt(r?.count || '0')),
      get<{ count: string }>("SELECT COUNT(*) as count FROM audit_logs WHERE action LIKE 'permission%'" + dp.clause, dp.params).then(r => parseInt(r?.count || '0')),
      get<{ count: string }>("SELECT COUNT(*) as count FROM audit_logs WHERE action IN ('create', 'update') AND entity_type = 'user'" + dp.clause, dp.params).then(r => parseInt(r?.count || '0')),
    ]);

    const [loginsByDay, changesByUser, demandsModified, exportsDone] = await Promise.all([
      all<{ day: string; count: string }>(
        "SELECT DATE(created_at) as day, COUNT(*) as count FROM audit_logs WHERE action = 'login'" + dp.clause.replace(/created_at/g, 'audit_logs.created_at') + ' GROUP BY day ORDER BY day DESC LIMIT 30',
        dp.params
      ),
      all<{ user_name: string; count: string }>(
        "SELECT user_name, COUNT(*) as count FROM audit_logs WHERE action IN ('create', 'update', 'delete')" + dp.clause + ' GROUP BY user_name ORDER BY count DESC LIMIT 10',
        dp.params
      ),
      all<{ day: string; count: string }>(
        "SELECT DATE(audit_logs.created_at) as day, COUNT(*) as count FROM audit_logs WHERE entity_type = 'demand'" + dp.clause.replace(/created_at/g, 'audit_logs.created_at') + ' GROUP BY day ORDER BY day DESC LIMIT 30',
        dp.params
      ),
      (async () => {
        const p: any[] = [];
        let sql = 'SELECT DATE(created_at) as day, COUNT(*) as count FROM export_logs';
        const wheres: string[] = [];
        if (start_date) { wheres.push(`created_at >= $${p.length + 1}`); p.push(start_date); }
        if (end_date) { wheres.push(`created_at <= $${p.length + 1}`); p.push(end_date); }
        if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
        sql += ' GROUP BY day ORDER BY day DESC LIMIT 30';
        return all<{ day: string; count: string }>(sql, p);
      })(),
    ]);

    res.json({
      total_logins: totalLogins,
      failed_logins: failedLogins,
      active_users: parseInt(activeUsers?.count || '0'),
      active_sessions: parseInt(activeSessions?.count || '0'),
      pdf_exports: pdfExports,
      excel_exports: excelExports,
      demands_created: demandsCreated,
      demands_updated: demandsUpdated,
      demands_deleted: demandsDeleted,
      permission_changes: permChanges,
      user_changes: userChanges,
      logins_by_day: loginsByDay,
      changes_by_user: changesByUser,
      demands_modified: demandsModified,
      exports_done: exportsDone
    });
  } catch (e) {
    logger.error('Audit dashboard stats error:', e);
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
    await logExport(req, req.user!, export_type, record_count || 0, filters);
    res.json({ message: 'Exportação registrada' });
  } catch (error) {
    logger.error('Log export error:', error);
    res.status(500).json({ error: 'Erro ao registrar exportação' });
  }
});

router.get('/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const total = await get<{ count: string }>('SELECT COUNT(*) as count FROM audit_logs');
    res.json({ total: parseInt(total?.count || '0') });
  } catch (e) {
    logger.error('Audit stats error:', e);
    res.status(500).json({ error: 'Erro ao obter estatísticas' });
  }
});

export default router;

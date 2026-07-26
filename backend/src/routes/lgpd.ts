import { Router, Request, Response } from 'express';
import { get, all } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const totalUsers = await get<{ count: string }>('SELECT COUNT(*) as count FROM users');
    const activeUsers = await get<{ count: string }>("SELECT COUNT(*) as count FROM users WHERE active = TRUE");
    const totalAuditLogs = await get<{ count: string }>('SELECT COUNT(*) as count FROM audit_logs');
    const totalBackups = await get<{ count: string }>("SELECT COUNT(*) as count FROM backups WHERE status = 'completed'");
    const lastBackup = await get<{ created_at: string; file_size: number }>(
      "SELECT created_at, file_size FROM backups WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1"
    );
    const totalExports = await get<{ count: string }>('SELECT COUNT(*) as count FROM export_logs');
    const totalSessions = await get<{ count: string }>(
      "SELECT COUNT(*) as count FROM active_sessions WHERE active = TRUE AND last_activity > NOW() - INTERVAL '30 minutes'"
    );
    const lastAccess = await get<{ created_at: string }>(
      "SELECT created_at FROM audit_logs ORDER BY created_at DESC LIMIT 1"
    );
    const dataRetention = await get<{ oldest: string; newest: string }>(
      "SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM audit_logs"
    );

    const usersByRole = await all<{ role: string; count: string }>(
      'SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC'
    );
    const permissionsCount = await get<{ count: string }>('SELECT COUNT(*) as count FROM permissions');
    const userPermissionsCount = await get<{ count: string }>('SELECT COUNT(*) as count FROM user_permissions');

    const exportTypes = await all<{ export_type: string; count: string }>(
      'SELECT export_type, COUNT(*) as count FROM export_logs GROUP BY export_type'
    );

    res.json({
      users: {
        total: parseInt(totalUsers?.count || '0'),
        active: parseInt(activeUsers?.count || '0'),
        by_role: usersByRole.reduce((acc: any, r) => ({ ...acc, [r.role]: parseInt(r.count) }), {})
      },
      data_stored: {
        audit_logs: parseInt(totalAuditLogs?.count || '0'),
        permissions: parseInt(permissionsCount?.count || '0'),
        user_permissions: parseInt(userPermissionsCount?.count || '0'),
        exports: parseInt(totalExports?.count || '0'),
        sessions_active: parseInt(totalSessions?.count || '0')
      },
      access: {
        last_access: lastAccess?.created_at || null,
        data_retention_start: dataRetention?.oldest || null,
        data_retention_end: dataRetention?.newest || null
      },
      backups: {
        total: parseInt(totalBackups?.count || '0'),
        last_backup: lastBackup?.created_at || null,
        last_backup_size: lastBackup?.file_size || 0
      },
      exports: exportTypes.reduce((acc: any, e) => ({ ...acc, [e.export_type]: parseInt(e.count) }), {})
    });
  } catch (error) {
    console.error('LGPD dashboard error:', error);
    res.status(500).json({ error: 'Erro ao carregar dados LGPD' });
  }
});

export default router;

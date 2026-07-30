import { Router, Request, Response } from 'express';
import os from 'os';
import { get, all, run } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.get('/health', authenticateToken, async (req: Request, res: Response) => {
  try {
    const start = Date.now();
    await get('SELECT 1');
    const dbTime = Date.now() - start;

    const totalDemands = await get<{ count: string }>('SELECT COUNT(*) as count FROM demands WHERE deleted_at IS NULL');
    const activeUsers = await get<{ count: string }>(
      "SELECT COUNT(*) as count FROM active_sessions WHERE active = TRUE AND last_activity > NOW() - INTERVAL '30 minutes'"
    );
    const lastBackup = await get<{ created_at: string }>(
      "SELECT created_at FROM backups WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1"
    );
    const integrations = await get<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_logs WHERE entity_type = 'integration' AND created_at > NOW() - INTERVAL '24 hours'`
    );

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = ((totalMem - freeMem) / totalMem) * 100;
    const cpuCores = os.cpus().length;
    const uptimeSeconds = os.uptime();
    const uptimeDays = Math.floor(uptimeSeconds / 86400);
    const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);

    res.json({
      server: {
        status: 'online',
        // ✅ CORREÇÃO: Não expõe hostname diretamente
        platform: os.platform(),
        cpu_cores: cpuCores,
        memory_usage_percent: Math.round(memUsage * 10) / 10,
        total_memory_gb: Math.round(totalMem / (1024 ** 3) * 10) / 10,
        free_memory_gb: Math.round(freeMem / (1024 ** 3) * 10) / 10,
        uptime: `${uptimeDays}d ${uptimeHours}h`,
      },
      database: {
        status: dbTime < 5000 ? 'online' : 'slow',
        response_time_ms: dbTime
      },
      api: {
        status: 'online',
        response_time_ms: Date.now() - start
      },
      app: {
        total_demands: parseInt(totalDemands?.count || '0'),
        active_users: parseInt(activeUsers?.count || '0'),
        last_backup: lastBackup?.created_at || null,
        integrations_24h: parseInt(integrations?.count || '0')
      }
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      server: { status: 'error' },
      database: { status: 'error' },
      api: { status: 'online' },
      app: {}
    });
  }
});

router.post('/snapshot', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const start = Date.now();
    await get('SELECT 1');
    const apiResponseTime = Date.now() - start;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const serverCpu = os.loadavg()[0] || 0;
    const serverMemory = ((totalMem - freeMem) / totalMem) * 100;
    const activeUsers = await get<{ count: string }>(
      "SELECT COUNT(*) as count FROM active_sessions WHERE active = TRUE AND last_activity > NOW() - INTERVAL '30 minutes'"
    );
    const totalDemands = await get<{ count: string }>('SELECT COUNT(*) as count FROM demands WHERE deleted_at IS NULL');
    const lastBackup = await get<{ created_at: string }>(
      "SELECT created_at FROM backups WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1"
    );

    await run(
      `INSERT INTO monitoring_logs (server_cpu, server_memory, api_response_time, db_connection_count, active_users, total_demands, last_backup_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [serverCpu, Math.round(serverMemory * 10) / 10, apiResponseTime, 0, parseInt(activeUsers?.count || '0'), parseInt(totalDemands?.count || '0'), lastBackup?.created_at || null]
    );

    res.json({ message: 'Snapshot recorded' });
  } catch (error) {
    logger.error('Snapshot error:', error);
    res.status(500).json({ error: 'Erro ao registrar snapshot' });
  }
});

router.get('/history', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 168;
    const logs = await all(
      `SELECT * FROM monitoring_logs ORDER BY recorded_at DESC LIMIT $1`,
      [limit]
    );
    res.json(logs);
  } catch (error) {
    logger.error('Monitoring history error:', error);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

export default router;

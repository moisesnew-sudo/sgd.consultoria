import { Router, Request, Response } from 'express';
import { get, all, run } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { logAudit, extractMeta } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.get('/', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const sessions = await all(
      `SELECT s.id, s.user_id, u.name, u.email, u.role, s.ip_address, s.browser, s.os,
        s.user_agent, s.last_activity, s.started_at, s.active,
        CASE WHEN s.last_activity > NOW() - INTERVAL '30 minutes' THEN 'Ativa' ELSE 'Inativa' END as status
       FROM active_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.active = TRUE
       ORDER BY s.last_activity DESC`
    );
    res.json(sessions);
  } catch (error) {
    logger.error('List sessions error:', error);
    res.status(500).json({ error: 'Erro ao listar sessões' });
  }
});

router.delete('/:id', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const session = await get<{ user_id: number; token_hash: string }>(
      'SELECT user_id, token_hash FROM active_sessions WHERE id = $1 AND active = TRUE',
      [req.params.id]
    );
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });

    await run('UPDATE active_sessions SET active = FALSE WHERE id = $1', [req.params.id]);
    if (session.token_hash) {
      // ✅ CORREÇÃO: Blacklist com expiração adequada (24h)
      await run(
        `INSERT INTO token_blacklist (token_hash, expires_at) VALUES ($1, NOW() + INTERVAL '24 hours') ON CONFLICT DO NOTHING`,
        [session.token_hash]
      );
    }

    await logAudit({
      entity_type: 'session', entity_id: String(req.params.id), action: 'session_terminated',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { target_user_id: session.user_id }, ip_address, user_agent
    });

    res.json({ message: 'Sessão encerrada com sucesso' });
  } catch (error) {
    logger.error('Terminate session error:', error);
    res.status(500).json({ error: 'Erro ao encerrar sessão' });
  }
});

router.get('/my-sessions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const sessions = await all(
      `SELECT id, ip_address, browser, os, last_activity, started_at, active,
        CASE WHEN last_activity > NOW() - INTERVAL '30 minutes' THEN 'Ativa' ELSE 'Inativa' END as status
       FROM active_sessions
       WHERE user_id = $1 AND active = TRUE
       ORDER BY last_activity DESC`,
      [req.user!.id]
    );
    res.json(sessions);
  } catch (error) {
    logger.error('List my sessions error:', error);
    res.status(500).json({ error: 'Erro ao listar sessões' });
  }
});

export default router;

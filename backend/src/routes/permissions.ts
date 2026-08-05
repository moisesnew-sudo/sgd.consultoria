import { Router, Request, Response } from 'express';
import { get, all, run } from '../database.js';
import { Permission, PermissionCategory, UserResponse } from '../types.js';
import { authenticateToken } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Você não possui permissão para executar esta ação.' });
    }
    const perms = await all<Permission>('SELECT * FROM permissions ORDER BY category, name');
    const grouped: Record<string, PermissionCategory> = {};
    for (const p of perms) {
      if (!grouped[p.category]) {
        grouped[p.category] = { category: p.category, permissions: [] };
      }
      grouped[p.category].permissions.push(p);
    }
    res.json(Object.values(grouped));
  } catch (error) {
    logger.error('List permissions error:', error);
    res.status(500).json({ error: 'Erro ao listar permissões' });
  }
});

router.get('/my', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user?.role === 'admin') {
      const perms = await all<{ key: string }>('SELECT key FROM permissions');
      return res.json(perms.map(p => p.key));
    }
    const result = await all<{ key: string }>(
      `SELECT p.key FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = $1 AND up.granted = TRUE`,
      [req.user!.id]
    );
    res.json(result.map(r => r.key));
  } catch (error) {
    logger.error('My permissions error:', error);
    res.status(500).json({ error: 'Erro ao carregar permissões' });
  }
});

router.get('/user/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Você não possui permissão para executar esta ação.' });
    }
    const userId = parseInt(req.params.id as string);
    const result = await all<{ permission_id: number; key: string; granted: boolean }>(
      `SELECT up.permission_id, p.key, up.granted FROM permissions p
       LEFT JOIN user_permissions up ON up.permission_id = p.id AND up.user_id = $1
       ORDER BY p.category, p.name`,
      [userId]
    );
    res.json(result);
  } catch (error) {
    logger.error('Get user permissions error:', error);
    res.status(500).json({ error: 'Erro ao carregar permissões do usuário' });
  }
});

router.put('/user/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Você não possui permissão para executar esta ação.' });
    }
    const userId = parseInt(req.params.id as string);
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'Formato de permissões inválido' });
    }

    const targetUser = await get<UserResponse>('SELECT id, name, email FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
    if (!targetUser) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await run('DELETE FROM user_permissions WHERE user_id = $1', [userId]);

    for (const p of permissions) {
      if (p.granted) {
        await run(
          'INSERT INTO user_permissions (user_id, permission_id, granted) VALUES ($1, $2, TRUE) ON CONFLICT (user_id, permission_id) DO UPDATE SET granted = TRUE',
          [userId, p.permission_id]
        );
      }
    }

    await logAudit({
      entity_type: 'user_permissions',
      entity_id: String(userId),
      action: 'update_permissions',
      user_id: req.user!.id,
      user_name: req.user!.name,
      details: {
        target_user_id: userId,
        target_user_name: targetUser.name,
        target_user_email: targetUser.email,
        permissions_count: permissions.filter((p: { granted?: boolean }) => p.granted).length,
      },
    });

    res.json({ message: 'Permissões atualizadas com sucesso' });
  } catch (error) {
    logger.error('Update user permissions error:', error);
    res.status(500).json({ error: 'Erro ao atualizar permissões' });
  }
});

export default router;

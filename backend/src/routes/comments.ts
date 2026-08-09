import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { get, all, run } from '../database.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { addTimelineEvent } from '../lib/helpers.js';
import { logger } from '../lib/logger.js';
import { publishEvent } from '../lib/eventBus.js';

const router = Router();

const commentSchema = z.object({
  body: z.string().min(1, 'Comentário não pode ser vazio').max(2000)
});

router.get('/:id/comments', authenticateToken, async (req: Request, res: Response) => {
  try {
    // ✅ CORREÇÃO: Verifica se demanda existe
    const demand = await get('SELECT id, title FROM demands WHERE id = $1 AND deleted_at IS NULL', [req.params.id as string]);
    if (!demand) {
      return res.status(404).json({ error: 'Demanda não encontrada' });
    }
    const comments = await all(
      'SELECT * FROM comments WHERE demand_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
      [req.params.id as string]
    );
    res.json(comments);
  } catch (e) {
    logger.error('List comments error:', e);
    res.status(500).json({ error: 'Erro ao listar comentários' });
  }
});

router.post('/:id/comments', authenticateToken, requirePermission('demands.edit'), async (req: Request, res: Response) => {
  try {
    if (req.user!.role === 'consulta') {
      return res.status(403).json({ error: 'Seu perfil (Consulta) é somente leitura' });
    }
    // ✅ CORREÇÃO: Verifica se demanda existe antes de comentar
    const demand = await get('SELECT id, title FROM demands WHERE id = $1 AND deleted_at IS NULL', [req.params.id as string]);
    if (!demand) {
      return res.status(404).json({ error: 'Demanda não encontrada' });
    }
    const { body } = commentSchema.parse(req.body);
    const result = await run(
      'INSERT INTO comments (demand_id, user_id, user_name, body, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [req.params.id as string, req.user!.id, req.user!.name, body]
    );
    const comment = result.rows[0];
    await addTimelineEvent(req.params.id as string, 'Comentário Adicionado',
      body.substring(0, 160), req.user!.name, undefined, 'comment', { comment_id: comment.id });
    await logAudit({
      entity_type: 'demand', entity_id: req.params.id as string, action: 'comment',
      user_id: req.user!.id, user_name: req.user!.name, details: { entity_title: demand.title, body: body.substring(0, 80) }
    });
    publishEvent('comment:created', {
      demandId: req.params.id as string,
      commentId: comment.id,
      userName: req.user!.name,
    });
    res.status(201).json(comment);
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: e.errors });
    logger.error('Create comment error:', e);
    res.status(500).json({ error: 'Erro ao criar comentário' });
  }
});

export default router;

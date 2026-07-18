import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { get, all, run } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

const commentSchema = z.object({
  body: z.string().min(1, 'Comentário não pode ser vazio').max(2000)
});

router.get('/:id/comments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const comments = await all(
      'SELECT * FROM comments WHERE demand_id = $1 ORDER BY created_at ASC',
      [req.params.id as string]
    );
    res.json(comments);
  } catch (e) {
    console.error('List comments error:', e);
    res.status(500).json({ error: 'Erro ao listar comentários' });
  }
});

router.post('/:id/comments', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user!.role === 'consulta') {
      return res.status(403).json({ error: 'Seu perfil (Consulta) é somente leitura' });
    }
    const { body } = commentSchema.parse(req.body);
    const result = await run(
      'INSERT INTO comments (demand_id, user_id, user_name, body, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [req.params.id as string, req.user!.id, req.user!.name, body]
    );
    const comment = result.rows[0];
    await logAudit({
      entity_type: 'demand', entity_id: req.params.id as string, action: 'comment',
      user_id: req.user!.id, user_name: req.user!.name, details: { body: body.substring(0, 80) }
    });
    res.status(201).json(comment);
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: e.errors });
    console.error('Create comment error:', e);
    res.status(500).json({ error: 'Erro ao criar comentário' });
  }
});

export default router;

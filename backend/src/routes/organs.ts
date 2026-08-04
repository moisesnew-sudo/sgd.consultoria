import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { get, all, run } from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { logAudit, extractMeta } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { normalizeText } from '../lib/text.js';

const router = Router();

const organSchema = z.object({
  name: z.string().min(1, 'Nome Ã© obrigatÃ³rio').max(120, 'MÃ¡ximo de 120 caracteres'),
});

function normalizeName(name: string): string {
  return normalizeText(name).toUpperCase();
}

// Lista (autenticados) â€” usada no cadastro mestre.
router.get('/', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const organs = await all(
      'SELECT id, name, active FROM organs ORDER BY name ASC'
    );
    res.json(organs);
  } catch (error) {
    logger.error('List organs error', { error });
    res.status(500).json({ error: 'Erro ao listar Ã³rgÃ£os' });
  }
});

// CriaÃ§Ã£o (apenas admin) â€” mantenha CAIXA ALTA, sem duplicidades.
router.post('/', authenticateToken, requireRole('admin', 'administrador'), async (req: Request, res: Response) => {
  try {
    const data = organSchema.parse(req.body);
    const name = normalizeName(data.name);
    if (!name) return res.status(400).json({ error: 'Nome invÃ¡lido' });

    const existing = await get('SELECT id FROM organs WHERE UPPER(name) = $1', [name]);
    if (existing) return res.status(409).json({ error: 'Ã“rgÃ£o jÃ¡ cadastrado' });

    const result = await run(
      'INSERT INTO organs (name, created_by) VALUES ($1, $2) RETURNING id, name, active',
      [name, req.user!.id]
    );
    const { ip_address, user_agent } = extractMeta(req);
    await logAudit({
      entity_type: 'organ', entity_id: String(result.rows[0].id), action: 'create',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { name }, ip_address, user_agent
    });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados invÃ¡lidos', details: error.errors });
    logger.error('Create organ error', { error });
    res.status(500).json({ error: 'Erro ao criar Ã³rgÃ£o' });
  }
});

// RenomeaÃ§Ã£o (administrador)
router.put('/:id', authenticateToken, requireRole('admin', 'administrador'), async (req: Request, res: Response) => {
  try {
    const existing = await get('SELECT * FROM organs WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Ã“rgÃ£o nÃ£o encontrado' });
    const data = organSchema.parse(req.body);
    const name = normalizeName(data.name);
    const dup = await get('SELECT id FROM organs WHERE UPPER(name) = $1 AND id != $2', [name, req.params.id]);
    if (dup) return res.status(409).json({ error: 'Ã“rgÃ£o jÃ¡ cadastrado' });
    await run('UPDATE organs SET name = $1, updated_at = NOW() WHERE id = $2', [name, req.params.id]);
    res.json({ id: Number(req.params.id), name, active: existing.active });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados invÃ¡lidos', details: error.errors });
    logger.error('Update organ error', { error });
    res.status(500).json({ error: 'Erro ao atualizar Ã³rgÃ£o' });
  }
});

// DesativaÃ§Ã£o (administrador)
router.delete('/:id', authenticateToken, requireRole('admin', 'administrador'), async (req: Request, res: Response) => {
  try {
    const existing = await get('SELECT * FROM organs WHERE id = $1 AND active = TRUE', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Ã“rgÃ£o nÃ£o encontrado ou jÃ¡ inativo' });
    await run('UPDATE organs SET active = FALSE, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'Ã“rgÃ£o desativado com sucesso' });
  } catch (error) {
    logger.error('Delete organ error', { error });
    res.status(500).json({ error: 'Erro ao desativar Ã³rgÃ£o' });
  }
});

export default router;

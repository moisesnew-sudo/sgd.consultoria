import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { get, all, run } from '../database.js';
import { Demand, TimelineEvent, Attachment } from '../types.js';
import { authenticateToken, requireRole, optionalAuth } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

const demandSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório'),
  description: z.string().optional(),
  category: z.string().min(1, 'Categoria é obrigatória'),
  status: z.enum(['analise', 'pendente', 'concluido', 'rejeitado']).optional(),
  priority: z.enum(['baixa', 'media', 'alta', 'urgente']).optional(),
  municipality: z.string().min(1, 'Município é obrigatório'),
  uf: z.string().length(2, 'UF deve ter 2 caracteres'),
  requested_value: z.number().optional(),
  prefeitura: z.string().optional(),
  proposal_number: z.string().optional(),
  organ: z.string().optional(),
  process_link: z.string().url('URL inválida').optional().or(z.literal('')),
  responsible_name: z.string().optional(),
  responsible_email: z.string().email('Email inválido').optional().or(z.literal('')),
  responsible_phone: z.string().optional(),
  notes: z.string().optional(),
   ano: z.coerce.number().int().optional()
});

const timelineEventSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório'),
  description: z.string().optional(),
  status_changed_to: z.enum(['analise', 'pendente', 'concluido', 'rejeitado']).optional()
});

router.get('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { status, priority, municipality, uf, category, search, page = '1', limit = '50' } = req.query;
    let sql = 'SELECT * FROM demands WHERE 1=1';
    const params: any[] = [];

    if (status && status !== 'all') { sql += ' AND status = $' + (params.length + 1); params.push(status); }
    if (priority && priority !== 'all') { sql += ' AND priority = $' + (params.length + 1); params.push(priority); }
    if (municipality && municipality !== 'all') { sql += ' AND municipality = $' + (params.length + 1); params.push(municipality); }
    if (uf && uf !== 'all') { sql += ' AND uf = $' + (params.length + 1); params.push(uf); }
    if (category && category !== 'all') { sql += ' AND category = $' + (params.length + 1); params.push(category); }
    if (search) {
      sql += ' AND (id ILIKE $' + (params.length + 1) + ' OR title ILIKE $' + (params.length + 2) + ' OR municipality ILIKE $' + (params.length + 3) + ')';
      const t = `%${search}%`;
      params.push(t, t, t);
    }

    const countResult = await get<{ count: string }>(sql.replace('SELECT *', 'SELECT COUNT(*) as count'), params);
    const total = parseInt(countResult?.count || '0');

    const offset = (Number(page) - 1) * Number(limit);
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(Number(limit), offset);

    const demands = await all<Demand>(sql, params);
    const demandsWithDetails = await Promise.all(demands.map(async demand => {
      const timeline = await all<TimelineEvent>(
        'SELECT * FROM timeline_events WHERE demand_id = $1 ORDER BY created_at DESC', [demand.id]
      );
      const attachments = await all<Attachment>(
        'SELECT * FROM attachments WHERE demand_id = $1', [demand.id]
      );
      return { ...demand, timeline, attachments };
    }));

    res.json({
      data: demandsWithDetails,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) }
    });
  } catch (error) {
    console.error('Get demands error:', error);
    res.status(500).json({ error: 'Erro ao buscar demandas' });
  }
});

// Calendar events: demands (created/updated) + timeline events
router.get('/calendar/events', optionalAuth, async (req: Request, res: Response) => {
  try {
    const demands = await all<Demand>(
      "SELECT id, title, status, priority, municipality, uf, created_at, updated_at FROM demands"
    );
    const events = await all(
      "SELECT demand_id, title, status_changed_to, created_at FROM timeline_events ORDER BY created_at DESC LIMIT 200"
    );
    const result = [
      ...demands.map(d => ({
        id: `d-${d.id}`,
        title: d.title,
        date: d.created_at,
        type: 'demand_created',
        status: d.status,
        priority: d.priority,
        demandId: d.id
      })),
      ...demands.map(d => ({
        id: `u-${d.id}`,
        title: `Atualização: ${d.title}`,
        date: d.updated_at,
        type: 'demand_updated',
        status: d.status,
        priority: d.priority,
        demandId: d.id
      })),
      ...events.map((e: any) => ({
        id: `t-${e.demand_id}-${e.created_at}`,
        title: e.title,
        date: e.created_at,
        type: 'timeline',
        status: e.status_changed_to || null,
        demandId: e.demand_id
      }))
    ];
    res.json(result);
  } catch (error) {
    console.error('Calendar events error:', error);
    res.status(500).json({ error: 'Erro ao buscar eventos' });
  }
});

router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    const demand = await get<Demand>('SELECT * FROM demands WHERE id = $1', [req.params.id as string]);
    if (!demand) return res.status(404).json({ error: 'Demanda não encontrada' });

    const timeline = await all<TimelineEvent>(
      'SELECT * FROM timeline_events WHERE demand_id = $1 ORDER BY created_at DESC', [demand.id]
    );
    const attachments = await all<Attachment>(
      'SELECT * FROM attachments WHERE demand_id = $1', [demand.id]
    );
    const comments = await all(
      'SELECT * FROM comments WHERE demand_id = $1 ORDER BY created_at ASC', [demand.id]
    );

    res.json({ ...demand, timeline, attachments, comments });
  } catch (error) {
    console.error('Get demand error:', error);
    res.status(500).json({ error: 'Erro ao buscar demanda' });
  }
});

router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user!.role === 'consulta') {
      return res.status(403).json({ error: 'Seu perfil (Consulta) é somente leitura' });
    }
    const data = demandSchema.parse(req.body);
    const currentYear = new Date().getFullYear();
    const countResult = await get<{ count: string }>('SELECT COUNT(*) as count FROM demands');
    const count = parseInt(countResult?.count || '0');
    const id = `${data.organ || 'SGD'}-${currentYear}-${String(count + 1).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const anoVal = data.ano ?? currentYear;

    await run(
      `INSERT INTO demands (id, title, description, category, status, priority, municipality, uf, requested_value, prefeitura, proposal_number, organ, process_link, responsible_name, responsible_email, responsible_phone, notes, created_by, created_at, updated_at, ano)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [id, data.title, data.description || '', data.category, data.status || 'pendente', data.priority || 'media',
       data.municipality, data.uf, data.requested_value || 0, data.prefeitura || `Prefeitura Municipal de ${data.municipality}`,
       data.proposal_number || `PROP-${currentYear}-${String(count + 1).padStart(4, '0')}`, data.organ || '',
       data.process_link || '', data.responsible_name || req.user!.name, data.responsible_email || req.user!.email,
       data.responsible_phone || '', data.notes || '', req.user!.id, now, now, anoVal]
    );

    await run(
      `INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`ev-${Date.now()}`, id, 'Demanda Cadastrada', `Demanda criada por ${req.user!.name}`, req.user!.name, data.status || 'pendente', now]
    );

    await run(
      'UPDATE municipalities SET demands_count = demands_count + 1, total_value = total_value + $1, updated_at = NOW() WHERE name = $2 AND uf = $3',
      [data.requested_value || 0, data.municipality, data.uf]
    );

    const newDemand = await get<Demand>('SELECT * FROM demands WHERE id = $1', [id]);
    await logAudit({
      entity_type: 'demand', entity_id: id, action: 'create',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { municipality: data.municipality, uf: data.uf, value: data.requested_value || 0 }
    });
    res.status(201).json(newDemand);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `"${e.path.join('.')}": ${e.message}`).join('; ');
      return res.status(400).json({ error: messages || 'Dados inválidos', details: error.errors });
    }
    console.error('Create demand error:', error);
    res.status(500).json({ error: 'Erro ao criar demanda' });
  }
});

router.put('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user!.role === 'consulta') {
      return res.status(403).json({ error: 'Seu perfil (Consulta) é somente leitura' });
    }
    const existing = await get<Demand>('SELECT * FROM demands WHERE id = $1', [req.params.id as string]);
    if (!existing) return res.status(404).json({ error: 'Demanda não encontrada' });

    const data = demandSchema.partial().parse(req.body);
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${col} = $${idx++}`);
        values.push(value);
      }
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      values.push(req.params.id as string);
      await run(`UPDATE demands SET ${updates.join(', ')} WHERE id = $${idx}`, values);

      if (data.status && data.status !== existing.status) {
        const user = await get<{ name: string }>('SELECT name FROM users WHERE id = $1', [req.user!.id]);
        await run(
          `INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`ev-${Date.now()}`, req.params.id as string, 'Status Alterado',
           `Status alterado de "${existing.status}" para "${data.status}" por ${user?.name || req.user!.name}`,
           user?.name || req.user!.name, data.status, new Date().toISOString()]
        );
      }
    }

    const updated = await get<Demand>('SELECT * FROM demands WHERE id = $1', [req.params.id as string]);
    await logAudit({
      entity_type: 'demand', entity_id: req.params.id as string, action: 'update',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { changed: Object.keys(data), status: data.status }
    });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `"${e.path.join('.')}": ${e.message}`).join('; ');
      return res.status(400).json({ error: messages || 'Dados inválidos', details: error.errors });
    }
    console.error('Update demand error:', error);
    res.status(500).json({ error: 'Erro ao atualizar demanda' });
  }
});

router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'admin' && req.user!.role !== 'gestor') {
      return res.status(403).json({ error: 'Apenas administradores e gestores podem remover demandas' });
    }

    const demand = await get<Demand>('SELECT * FROM demands WHERE id = $1', [req.params.id as string]);
    if (!demand) return res.status(404).json({ error: 'Demanda não encontrada' });

    await run('DELETE FROM timeline_events WHERE demand_id = $1', [req.params.id as string]);
    await run('DELETE FROM attachments WHERE demand_id = $1', [req.params.id as string]);
    await run('DELETE FROM demands WHERE id = $1', [req.params.id as string]);

    await run(
      'UPDATE municipalities SET demands_count = GREATEST(demands_count - 1, 0), total_value = GREATEST(total_value - $1, 0), updated_at = NOW() WHERE name = $2 AND uf = $3',
      [demand.requested_value, demand.municipality, demand.uf]
    );

    await logAudit({
      entity_type: 'demand', entity_id: req.params.id as string, action: 'delete',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { municipality: demand.municipality, uf: demand.uf }
    });
    res.json({ message: 'Demanda removida com sucesso' });
  } catch (error) {
    console.error('Delete demand error:', error);
    res.status(500).json({ error: 'Erro ao remover demanda' });
  }
});

router.post('/:id/timeline', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user!.role === 'consulta') {
      return res.status(403).json({ error: 'Seu perfil (Consulta) é somente leitura' });
    }
    const demand = await get<Demand>('SELECT * FROM demands WHERE id = $1', [req.params.id as string]);
    if (!demand) return res.status(404).json({ error: 'Demanda não encontrada' });

    const data = timelineEventSchema.parse(req.body);
    const eventId = `ev-${Date.now()}`;
    const now = new Date().toISOString();

    await run(
      `INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [eventId, req.params.id as string, data.title, data.description || 'Nenhuma descrição informada.', req.user!.name, data.status_changed_to || null, now]
    );

    if (data.status_changed_to) {
      await run('UPDATE demands SET status = $1, updated_at = NOW() WHERE id = $2', [data.status_changed_to, req.params.id as string]);
    }

    const event = await get<TimelineEvent>('SELECT * FROM timeline_events WHERE id = $1', [eventId]);
    res.status(201).json(event);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    console.error('Add timeline event error:', error);
    res.status(500).json({ error: 'Erro ao adicionar evento' });
  }
});

router.get('/stats/dashboard', optionalAuth, async (req: Request, res: Response) => {
  try {
    const total = await get<{ count: string }>('SELECT COUNT(*) as count FROM demands');
    const byStatus = await all<{ status: string; count: string }>(
      'SELECT status, COUNT(*) as count FROM demands GROUP BY status ORDER BY count DESC'
    );
    const byPriority = await all<{ priority: string; count: string }>(
      'SELECT priority, COUNT(*) as count FROM demands GROUP BY priority ORDER BY count DESC'
    );
    const byUf = await all<{ uf: string; count: string }>(
      'SELECT uf, COUNT(*) as count FROM demands GROUP BY uf ORDER BY count DESC'
    );
    const totalValue = await get<{ total: string | null }>('SELECT SUM(requested_value) as total FROM demands');
    const today = new Date().toISOString().split('T')[0];
    const todayCount = await get<{ count: string }>(
      'SELECT COUNT(*) as count FROM demands WHERE DATE(created_at) = $1', [today]
    );
    const overdue = await getAllOverdue();

    res.json({
      total: parseInt(total?.count || '0'),
      byStatus: byStatus.reduce((acc, item) => ({ ...acc, [item.status]: parseInt(item.count) }), {}),
      byPriority: byPriority.reduce((acc, item) => ({ ...acc, [item.priority]: parseInt(item.count) }), {}),
      byUf: byUf.map(u => ({ uf: u.uf, count: parseInt(u.count) })),
      totalValue: parseFloat(totalValue?.total || '0'),
      todayCount: parseInt(todayCount?.count || '0'),
      overdue
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

async function getAllOverdue() {
  const result = await get<{ count: string }>(`
    SELECT COUNT(*) as count FROM demands 
    WHERE status IN ('pendente', 'analise')
    AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 > 
      CASE priority 
        WHEN 'urgente' THEN 5 
        WHEN 'alta' THEN 15 
        WHEN 'media' THEN 30 
        ELSE 45 
      END
  `);
  return parseInt(result?.count || '0');
}

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../database.js';
import { Demand, TimelineEvent, Attachment } from '../types.js';
import { authenticateToken, requireRole, optionalAuth } from '../middleware/auth.js';

const router = Router();

const demandSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório'),
  description: z.string().optional(),
  category: z.string().min(1, 'Categoria é obrigatória'),
  status: z.enum(['triagem', 'analise_tecnica', 'em_andamento', 'concluido', 'cancelado']).optional(),
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
  notes: z.string().optional()
});

const timelineEventSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório'),
  description: z.string().optional(),
  status_changed_to: z.enum(['triagem', 'analise_tecnica', 'em_andamento', 'concluido', 'cancelado']).optional()
});

// Get all demands with filters
router.get('/', optionalAuth, (req: Request, res: Response) => {
  try {
    const { 
      status, 
      priority, 
      municipality, 
      uf, 
      category,
      search,
      page = '1',
      limit = '50'
    } = req.query;

    let query = 'SELECT * FROM demands WHERE 1=1';
    const params: any[] = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (priority && priority !== 'all') {
      query += ' AND priority = ?';
      params.push(priority);
    }

    if (municipality && municipality !== 'all') {
      query += ' AND municipality = ?';
      params.push(municipality);
    }

    if (uf && uf !== 'all') {
      query += ' AND uf = ?';
      params.push(uf);
    }

    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND (id LIKE ? OR title LIKE ? OR municipality LIKE ? OR description LIKE ? OR responsible_name LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const { count } = db.prepare(countQuery).get(...params) as { count: number };

    // Pagination
    const offset = (Number(page) - 1) * Number(limit);
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);

    const demands = db.prepare(query).all(...params) as Demand[];

    // Get timeline events and attachments for each demand
    const demandsWithDetails = demands.map(demand => {
      const timeline = db.prepare(
        'SELECT * FROM timeline_events WHERE demand_id = ? ORDER BY created_at DESC'
      ).all(demand.id) as TimelineEvent[];

      const attachments = db.prepare(
        'SELECT * FROM attachments WHERE demand_id = ?'
      ).all(demand.id) as Attachment[];

      return {
        ...demand,
        timeline,
        attachments
      };
    });

    res.json({
      data: demandsWithDetails,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        pages: Math.ceil(count / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get demands error:', error);
    res.status(500).json({ error: 'Erro ao buscar demandas' });
  }
});

// Get single demand
router.get('/:id', optionalAuth, (req: Request, res: Response) => {
  try {
    const demand = db.prepare('SELECT * FROM demands WHERE id = ?').get(req.params.id) as Demand | undefined;

    if (!demand) {
      return res.status(404).json({ error: 'Demanda não encontrada' });
    }

    const timeline = db.prepare(
      'SELECT * FROM timeline_events WHERE demand_id = ? ORDER BY created_at DESC'
    ).all(demand.id) as TimelineEvent[];

    const attachments = db.prepare(
      'SELECT * FROM attachments WHERE demand_id = ?'
    ).all(demand.id) as Attachment[];

    res.json({
      ...demand,
      timeline,
      attachments
    });
  } catch (error) {
    console.error('Get demand error:', error);
    res.status(500).json({ error: 'Erro ao buscar demanda' });
  }
});

// Create demand
router.post('/', authenticateToken, (req: Request, res: Response) => {
  try {
    const data = demandSchema.parse(req.body);

    // Generate unique ID
    const year = new Date().getFullYear();
    const count = db.prepare('SELECT COUNT(*) as count FROM demands').get() as { count: number };
    const id = `${data.organ || 'SGD'}-${year}-${String(count.count + 1).padStart(3, '0')}`;

    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO demands (
        id, title, description, category, status, priority,
        municipality, uf, requested_value, prefeitura, proposal_number,
        organ, process_link, responsible_name, responsible_email,
        responsible_phone, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.title,
      data.description || '',
      data.category,
      data.status || 'triagem',
      data.priority || 'media',
      data.municipality,
      data.uf,
      data.requested_value,
      data.prefeitura || `Prefeitura Municipal de ${data.municipality}`,
      data.proposal_number || `PROP-${year}-${String(count.count + 1).padStart(4, '0')}`,
      data.organ || '',
      data.process_link || '',
      data.responsible_name || req.user!.name,
      data.responsible_email || req.user!.email,
      data.responsible_phone || '',
      data.notes || '',
      req.user!.id,
      now,
      now
    );

    // Create initial timeline event
    db.prepare(`
      INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `ev-${Date.now()}`,
      id,
      'Demanda Cadastrada',
      `Demanda criada por ${req.user!.name}`,
      req.user!.name,
      data.status || 'triagem',
      now
    );

    // Update municipality stats
    db.prepare(`
      UPDATE municipalities 
      SET demands_count = demands_count + 1, 
          total_value = total_value + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE name = ? AND uf = ?
    `).run(data.requested_value, data.municipality, data.uf);

    const newDemand = db.prepare('SELECT * FROM demands WHERE id = ?').get(id);

    res.status(201).json(newDemand);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Create demand error:', error);
    res.status(500).json({ error: 'Erro ao criar demanda' });
  }
});

// Update demand
router.put('/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM demands WHERE id = ?').get(req.params.id) as Demand | undefined;

    if (!existing) {
      return res.status(404).json({ error: 'Demanda não encontrada' });
    }

    const data = demandSchema.partial().parse(req.body);
    const now = new Date().toISOString();

    // Track status changes
    if (data.status && data.status !== existing.status) {
      db.prepare(`
        INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        `ev-${Date.now()}`,
        req.params.id,
        `Status alterado para ${data.status}`,
        `Alterado por ${req.user!.name}`,
        req.user!.name,
        data.status,
        now
      );
    }

    // Update demand
    db.prepare(`
      UPDATE demands SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        municipality = COALESCE(?, municipality),
        uf = COALESCE(?, uf),
        requested_value = COALESCE(?, requested_value),
        prefeitura = COALESCE(?, prefeitura),
        proposal_number = COALESCE(?, proposal_number),
        organ = COALESCE(?, organ),
        process_link = COALESCE(?, process_link),
        responsible_name = COALESCE(?, responsible_name),
        responsible_email = COALESCE(?, responsible_email),
        responsible_phone = COALESCE(?, responsible_phone),
        notes = COALESCE(?, notes),
        updated_at = ?
      WHERE id = ?
    `).run(
      data.title,
      data.description,
      data.category,
      data.status,
      data.priority,
      data.municipality,
      data.uf,
      data.requested_value,
      data.prefeitura,
      data.proposal_number,
      data.organ,
      data.process_link,
      data.responsible_name,
      data.responsible_email,
      data.responsible_phone,
      data.notes,
      now,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM demands WHERE id = ?').get(req.params.id);

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Update demand error:', error);
    res.status(500).json({ error: 'Erro ao atualizar demanda' });
  }
});

// Delete demand (admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const demand = db.prepare('SELECT * FROM demands WHERE id = ?').get(req.params.id);

    if (!demand) {
      return res.status(404).json({ error: 'Demanda não encontrada' });
    }

    db.prepare('DELETE FROM demands WHERE id = ?').run(req.params.id);

    res.json({ message: 'Demanda removida com sucesso' });
  } catch (error) {
    console.error('Delete demand error:', error);
    res.status(500).json({ error: 'Erro ao remover demanda' });
  }
});

// Add timeline event
router.post('/:id/timeline', authenticateToken, (req: Request, res: Response) => {
  try {
    const demand = db.prepare('SELECT * FROM demands WHERE id = ?').get(req.params.id);

    if (!demand) {
      return res.status(404).json({ error: 'Demanda não encontrada' });
    }

    const data = timelineEventSchema.parse(req.body);
    const now = new Date().toISOString();
    const eventId = `ev-${Date.now()}`;

    db.prepare(`
      INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      req.params.id,
      data.title,
      data.description || '',
      req.user!.name,
      data.status_changed_to || null,
      now
    );

    // Update demand status if provided
    if (data.status_changed_to) {
      db.prepare('UPDATE demands SET status = ?, updated_at = ? WHERE id = ?')
        .run(data.status_changed_to, now, req.params.id);
    }

    const event = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(eventId);

    res.status(201).json(event);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Add timeline event error:', error);
    res.status(500).json({ error: 'Erro ao adicionar evento' });
  }
});

// Get dashboard stats
router.get('/stats/dashboard', optionalAuth, (req: Request, res: Response) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM demands').get() as { count: number };
    
    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM demands 
      GROUP BY status
    `).all() as { status: string; count: number }[];

    const byPriority = db.prepare(`
      SELECT priority, COUNT(*) as count 
      FROM demands 
      GROUP BY priority
    `).all() as { priority: string; count: number }[];

    const byUf = db.prepare(`
      SELECT uf, COUNT(*) as count 
      FROM demands 
      GROUP BY uf
      ORDER BY count DESC
    `).all() as { uf: string; count: number }[];

    const totalValue = db.prepare('SELECT SUM(requested_value) as total FROM demands').get() as { total: number };

    const today = new Date().toISOString().split('T')[0];
    const todayCount = db.prepare(
      "SELECT COUNT(*) as count FROM demands WHERE DATE(created_at) = DATE(?)"
    ).get(today) as { count: number };

    // Calculate SLA metrics - count demands that are still open and have exceeded their SLA
    const overdue = db.prepare(`
      SELECT COUNT(*) as count FROM demands 
      WHERE status IN ('triagem', 'analise_tecnica', 'em_andamento')
      AND julianday('now') - julianday(created_at) > 
        CASE priority 
          WHEN 'urgente' THEN 5 
          WHEN 'alta' THEN 15 
          WHEN 'media' THEN 30 
          ELSE 45 
        END
    `).get() as { count: number };

    res.json({
      total: total.count,
      byStatus: byStatus.reduce((acc, item) => ({ ...acc, [item.status]: item.count }), {}),
      byPriority: byPriority.reduce((acc, item) => ({ ...acc, [item.priority]: item.count }), {}),
      byUf,
      totalValue: totalValue.total || 0,
      todayCount: todayCount.count,
      overdue: overdue.count
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

export default router;
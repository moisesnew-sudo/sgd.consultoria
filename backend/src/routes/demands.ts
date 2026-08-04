import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { get, all, run } from '../database.js';
import { DEMAND_STATUSES, DEMAND_PRIORITIES } from '../types.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { logAudit, extractMeta } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { getCached, setCache, clearCache } from '../lib/cache.js';
import { addTimelineEvent, buildUpdateQuery } from '../lib/helpers.js';

const router = Router();

const demandSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório'),
  description: z.string().optional(),
  category: z.string().min(1, 'Categoria é obrigatória'),
  status: z.enum(DEMAND_STATUSES).optional(),
  priority: z.enum(DEMAND_PRIORITIES).optional(),
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
  status_changed_to: z.enum(DEMAND_STATUSES).optional(),
});

/* Campos textuais normalizados para CAIXA ALTA (regra institucional do SGD) */
const TEXT_UPPER_FIELDS = [
  'title', 'description', 'category', 'municipality',
  'prefeitura', 'organ', 'proposal_number', 'responsible_name', 'notes',
] as const;

function normalizeDemandText(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...data };
  for (const f of TEXT_UPPER_FIELDS) {
    if (typeof out[f] === 'string' && out[f].trim()) {
      const up = out[f].trim().toUpperCase();
      if (up) out[f] = up;
    }
  }
  if (typeof out.uf === 'string' && out.uf.trim()) out.uf = out.uf.trim().toUpperCase();
  if (typeof out.responsible_email === 'string' && out.responsible_email.trim()) {
    out.responsible_email = out.responsible_email.trim().toLowerCase();
  }
  return out;
}

async function saveDemandVersion(demandId: string, snapshot: any, changedBy: number, changedByName: string, ipAddress?: string) {
  const version = await get<{ v: number }>(
    'SELECT COALESCE(MAX(version), 0) + 1 as v FROM demand_versions WHERE demand_id = $1',
    [demandId]
  );
  await run(
    `INSERT INTO demand_versions (demand_id, version, snapshot, changed_by, changed_by_name, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [demandId, version?.v || 1, JSON.stringify(snapshot), changedBy, changedByName, ipAddress || null]
  );
}

async function logStatusChange(demandId: string, from: string, to: string, userName: string) {
  await addTimelineEvent(demandId, 'Status Alterado',
    `Status alterado de "${from}" para "${to}" por ${userName}`,
    userName, to, 'status_changed', { from, to });
  if (to === 'concluido') {
    await addTimelineEvent(demandId, 'Demanda Concluída',
      `Demanda concluída por ${userName}`,
      userName, to, 'concluded', { from, to });
  }
}

// ✅ CORREÇÃO: Geração segura de ID usando crypto.randomUUID()
function generateDemandId(organ: string, year: number): string {
  const shortUuid = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${organ || 'SGD'}-${year}-${shortUuid}`;
}

router.get('/', authenticateToken, requirePermission('demands.view'), async (req: Request, res: Response) => {
  try {
    const {
      status, priority, municipality, uf, category, search,
      organ, proposal_number, object, responsible,
      valueMin, valueMax, dateFrom, dateTo, updatedFrom, updatedTo,
      include_deleted, page = '1', limit = '50',
    } = req.query;
    // ✅ CORREÇÃO: Lógica correta de include_deleted
    let sql = 'SELECT * FROM demands';
    const params: any[] = [];
    const conditions: string[] = [];

    if (include_deleted === 'true' && req.user?.role === 'admin') {
      // Não filtra deleted_at — mostra tudo
    } else {
      conditions.push('deleted_at IS NULL');
    }

    if (status && status !== 'all') { conditions.push(`status = $${params.length + 1}`); params.push(status); }
    if (priority && priority !== 'all') { conditions.push(`priority = $${params.length + 1}`); params.push(priority); }
    if (municipality && municipality !== 'all') { conditions.push(`municipality ILIKE $${params.length + 1}`); params.push(municipality); }
    if (uf && uf !== 'all') { conditions.push(`uf = $${params.length + 1}`); params.push(String(uf).toUpperCase()); }
    if (category && category !== 'all') { conditions.push(`category ILIKE $${params.length + 1}`); params.push(category); }
    if (organ && organ !== 'all') { conditions.push(`organ ILIKE $${params.length + 1}`); params.push(organ); }
    if (proposal_number && proposal_number !== 'all') {
      conditions.push(`proposal_number ILIKE $${params.length + 1}`);
      params.push(`%${proposal_number}%`);
    }
    if (object && object !== 'all') {
      conditions.push(`title ILIKE $${params.length + 1}`);
      params.push(`%${object}%`);
    }
    if (responsible && responsible !== 'all') { conditions.push(`responsible_name ILIKE $${params.length + 1}`); params.push(responsible); }
    if (valueMin && valueMin !== 'all') { conditions.push(`requested_value >= $${params.length + 1}`); params.push(Number(valueMin)); }
    if (valueMax && valueMax !== 'all') { conditions.push(`requested_value <= $${params.length + 1}`); params.push(Number(valueMax)); }
    if (dateFrom && dateFrom !== 'all') { conditions.push(`created_at >= $${params.length + 1}`); params.push(dateFrom); }
    if (dateTo && dateTo !== 'all') { conditions.push(`created_at < $${params.length + 1}`); params.push(new Date(`${dateTo}T23:59:59`).toISOString()); }
    if (updatedFrom && updatedFrom !== 'all') { conditions.push(`updated_at >= $${params.length + 1}`); params.push(updatedFrom); }
    if (updatedTo && updatedTo !== 'all') { conditions.push(`updated_at < $${params.length + 1}`); params.push(new Date(`${updatedTo}T23:59:59`).toISOString()); }
    if (search) {
      conditions.push(`(id ILIKE $${params.length + 1} OR title ILIKE $${params.length + 2} OR municipality ILIKE $${params.length + 3} OR organ ILIKE $${params.length + 4} OR proposal_number ILIKE $${params.length + 5} OR responsible_name ILIKE $${params.length + 6} OR description ILIKE $${params.length + 7} OR category ILIKE $${params.length + 8})`);
      const t = `%${search}%`;
      params.push(t, t, t, t, t, t, t, t);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const countSql = `SELECT COUNT(*) as count FROM demands ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}`;
    const countResult = await get<{ count: string }>(countSql, [...params]);
    const total = parseInt(countResult?.count || '0');
    const offset = (Number(page) - 1) * Number(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), offset);
    const demands = await all(sql, params);

    // ✅ CORREÇÃO: JSON aggregation para evitar N+1
    const demandIds = demands.map(d => d.id);
    let demandsWithDetails: any[] = demands;
    if (demandIds.length > 0) {
      const timelines = await all(
        `SELECT demand_id, json_agg(t.* ORDER BY t.created_at DESC) as events
         FROM timeline_events t WHERE demand_id = ANY($1) GROUP BY demand_id`,
        [demandIds]
      );
      const attachments = await all(
        `SELECT demand_id, json_agg(a.*) as files
         FROM attachments a WHERE demand_id = ANY($1) AND deleted_at IS NULL GROUP BY demand_id`,
        [demandIds]
      );
      const timelineMap = Object.fromEntries(timelines.map(t => [t.demand_id, t.events || []]));
      const attachmentMap = Object.fromEntries(attachments.map(a => [a.demand_id, a.files || []]));
      demandsWithDetails = demands.map(d => ({
        ...d,
        timeline: timelineMap[d.id] || [],
        attachments: attachmentMap[d.id] || []
      }));
    }

    res.json({
      data: demandsWithDetails,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) }
    });
  } catch (error) {
    logger.error('Get demands error', { error });
    res.status(500).json({ error: 'Erro ao buscar demandas' });
  }
});

router.get('/calendar/events', authenticateToken, requirePermission('demands.view'), async (req: Request, res: Response) => {
  try {
    const demands = await all(
      "SELECT id, title, status, priority, municipality, uf, created_at, updated_at FROM demands WHERE deleted_at IS NULL"
    );
    const events = await all(
      "SELECT demand_id, title, status_changed_to, created_at FROM timeline_events ORDER BY created_at DESC LIMIT 200"
    );
    const result = [
      ...demands.map(d => ({
        id: `d-${d.id}`, title: d.title, date: d.created_at,
        type: 'demand_created', status: d.status, priority: d.priority, demandId: d.id
      })),
      ...demands.map(d => ({
        id: `u-${d.id}`, title: `Atualização: ${d.title}`, date: d.updated_at,
        type: 'demand_updated', status: d.status, priority: d.priority, demandId: d.id
      })),
      ...events.map((e: any) => ({
        id: `t-${e.demand_id}-${e.created_at}`, title: e.title, date: e.created_at,
        type: 'timeline', status: e.status_changed_to || null, demandId: e.demand_id
      }))
    ];
    res.json(result);
  } catch (error) {
    logger.error('Calendar events error', { error });
    res.status(500).json({ error: 'Erro ao buscar eventos' });
  }
});

router.get('/stats/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    const total = await get<{ count: string }>('SELECT COUNT(*) as count FROM demands WHERE deleted_at IS NULL');
    const cacheKey = 'dashboard-stats';
    const cached = getCached<any>(cacheKey);
    if (cached) return res.json(cached);

    const byStatus = await all<{ status: string; count: string }>(
      'SELECT status, COUNT(*) as count FROM demands WHERE deleted_at IS NULL GROUP BY status ORDER BY count DESC'
    );
    const byPriority = await all<{ priority: string; count: string }>(
      'SELECT priority, COUNT(*) as count FROM demands WHERE deleted_at IS NULL GROUP BY priority ORDER BY count DESC'
    );
    const byUf = await all<{ uf: string; count: string }>(
      'SELECT uf, COUNT(*) as count FROM demands WHERE deleted_at IS NULL GROUP BY uf ORDER BY count DESC'
    );
    const totalValue = await get<{ total: string | null }>('SELECT SUM(requested_value) as total FROM demands WHERE deleted_at IS NULL');
    const today = new Date().toISOString().split('T')[0];
    const todayCount = await get<{ count: string }>(
      'SELECT COUNT(*) as count FROM demands WHERE deleted_at IS NULL AND DATE(created_at) = $1', [today]
    );
    const overdue = await getAllOverdue();
    const result = {
      total: parseInt(total?.count || '0'),
      byStatus: byStatus.reduce((acc, item) => ({ ...acc, [item.status]: parseInt(item.count) }), {}),
      byPriority: byPriority.reduce((acc, item) => ({ ...acc, [item.priority]: parseInt(item.count) }), {}),
      byUf: byUf.map(u => ({ uf: u.uf, count: parseInt(u.count) })),
      totalValue: parseFloat(totalValue?.total || '0'),
      todayCount: parseInt(todayCount?.count || '0'),
      overdue
    };
    setCache(cacheKey, result, 30_000);
    res.json(result);
  } catch (error) {
    logger.error('Dashboard stats error', { error });
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

router.get('/stats/executive', authenticateToken, requirePermission('dashboard.view'), async (req: Request, res: Response) => {
  try {
    const { year, uf, status, dateFrom, dateTo } = req.query as Record<string, string>;
    const cacheKey = `executive-stats:${year || ''}:${uf || ''}:${status || ''}:${dateFrom || ''}:${dateTo || ''}`;
    const cached = getCached<any>(cacheKey);
    if (cached) return res.json(cached);

    const conditions = ['deleted_at IS NULL'];
    const params: any[] = [];
    let idx = 1;

    if (year) { conditions.push(`EXTRACT(YEAR FROM created_at) = $${idx++}`); params.push(parseInt(year)); }
    if (uf) { conditions.push(`uf = $${idx++}`); params.push(uf.toUpperCase()); }
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    if (dateFrom) { conditions.push(`created_at >= $${idx++}`); params.push(dateFrom); }
    if (dateTo) { conditions.push(`created_at <= ($${idx++}::date + INTERVAL '1 day')`); params.push(dateTo); }

    const where = conditions.join(' AND ');
    const base = `FROM demands WHERE ${where}`;
    const w = where;

    const [totalRow, totalValueRow, avgValueRow, ...rest] = await Promise.all([
      get<{ count: string }>(`SELECT COUNT(*) as count ${base}`, params),
      get<{ total: string | null }>(`SELECT COALESCE(SUM(requested_value), 0) as total ${base}`, params),
      get<{ avg: string | null }>(`SELECT COALESCE(AVG(requested_value), 0) as avg ${base}`, params),
      all<{ uf: string; count: string; total_value: string }>(
        `SELECT uf, COUNT(*) as count, COALESCE(SUM(requested_value), 0) as total_value FROM demands WHERE ${w} GROUP BY uf ORDER BY count DESC`, params),
      all<{ status: string; count: string; total_value: string }>(
        `SELECT status, COUNT(*) as count, COALESCE(SUM(requested_value), 0) as total_value FROM demands WHERE ${w} GROUP BY status ORDER BY count DESC`, params),
      all<{ organ: string; count: string; total_value: string }>(
        `SELECT organ, COUNT(*) as count, COALESCE(SUM(requested_value), 0) as total_value FROM demands WHERE ${w} AND organ != '' GROUP BY organ ORDER BY count DESC LIMIT 12`, params),
      all<{ municipality: string; uf: string; count: string; total_value: string }>(
        `SELECT municipality, uf, COUNT(*) as count, COALESCE(SUM(requested_value), 0) as total_value FROM demands WHERE ${w} GROUP BY municipality, uf ORDER BY count DESC LIMIT 15`, params),
      all<{ month: string; count: string; total_value: string }>(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*) as count, COALESCE(SUM(requested_value), 0) as total_value FROM demands WHERE ${w} GROUP BY month ORDER BY month`, params),
    ]);

    const [byUf, byStatus, byOrgan, byMunicipality, byMonth] = rest;

    const result = {
      summary: {
        total: parseInt(totalRow?.count || '0'),
        totalValue: parseFloat(totalValueRow?.total || '0'),
        avgValue: parseFloat(avgValueRow?.avg || '0'),
        pending: parseInt((byStatus.find((s: any) => s.status === 'pendente') as any)?.count || '0'),
        inAnalysis: parseInt((byStatus.find((s: any) => s.status === 'analise') as any)?.count || '0'),
        completed: parseInt((byStatus.find((s: any) => s.status === 'concluido') as any)?.count || '0'),
        rejected: parseInt((byStatus.find((s: any) => s.status === 'rejeitado') as any)?.count || '0'),
      },
      byUf: byUf.map((u: any) => ({ uf: u.uf, count: parseInt(u.count), totalValue: parseFloat(u.total_value) })),
      byStatus: byStatus.map((s: any) => ({ status: s.status, count: parseInt(s.count), totalValue: parseFloat(s.total_value) })),
      byOrgan: byOrgan.map((o: any) => ({ organ: o.organ, count: parseInt(o.count), totalValue: parseFloat(o.total_value) })),
      byMunicipality: byMunicipality.map((m: any) => ({ municipality: m.municipality, uf: m.uf, count: parseInt(m.count), totalValue: parseFloat(m.total_value) })),
      byMonth: byMonth.map((m: any) => ({ month: m.month, count: parseInt(m.count), totalValue: parseFloat(m.total_value) })),
    };

    setCache(cacheKey, result, 60_000);
    res.json(result);
  } catch (error) {
    logger.error('Executive stats error', { error });
    res.status(500).json({ error: 'Erro ao buscar estatísticas executivas' });
  }
});

async function getAllOverdue() {
  const result = await get<{ count: string }>(`
    SELECT COUNT(*) as count FROM demands
    WHERE status IN ('pendente', 'analise')
    AND deleted_at IS NULL
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

router.get('/:id/versions', authenticateToken, requirePermission('demands.view'), async (req: Request, res: Response) => {
  try {
    const versions = await all(
      `SELECT id, version, snapshot, changed_by, changed_by_name, ip_address, created_at
       FROM demand_versions WHERE demand_id = $1 ORDER BY version DESC`,
      [req.params.id as string]
    );
    res.json(versions);
  } catch (error) {
    logger.error('Get versions error', { error });
    res.status(500).json({ error: 'Erro ao buscar versões' });
  }
});

router.get('/:id', authenticateToken, requirePermission('demands.view'), async (req: Request, res: Response) => {
  try {
    const demand = await get('SELECT * FROM demands WHERE id = $1 AND deleted_at IS NULL', [req.params.id as string]);
    if (!demand) return res.status(404).json({ error: 'Demanda não encontrada' });
    const [timeline, attachments, comments] = await Promise.all([
      all('SELECT * FROM timeline_events WHERE demand_id = $1 ORDER BY created_at DESC', [demand.id]),
      all('SELECT * FROM attachments WHERE demand_id = $1 AND deleted_at IS NULL', [demand.id]),
      all('SELECT * FROM comments WHERE demand_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC', [demand.id])
    ]);
    res.json({ ...demand, timeline, attachments, comments });
  } catch (error) {
    logger.error('Get demand error', { error });
    res.status(500).json({ error: 'Erro ao buscar demanda' });
  }
});

router.post('/', authenticateToken, requirePermission('demands.create'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    if (req.user!.role === 'consulta') {
      return res.status(403).json({ error: 'Consulta não pode cadastrar demandas' });
    }
    const data = normalizeDemandText(demandSchema.parse(req.body));
    const currentYear = new Date().getFullYear();
    // ✅ CORREÇÃO: UUID seguro em vez de COUNT(*)+1
    const id = generateDemandId(data.organ || 'SGD', currentYear);
    const now = new Date().toISOString();
    const anoVal = data.ano ?? currentYear;

    await run(
      `INSERT INTO demands (id, title, description, category, status, priority, municipality, uf, requested_value, prefeitura, proposal_number, organ, process_link, responsible_name, responsible_email, responsible_phone, notes, created_by, created_at, updated_at, ano)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [id, data.title, data.description || '', data.category, data.status || 'pendente', data.priority || 'media',
       data.municipality, data.uf, data.requested_value || 0, data.prefeitura || `Prefeitura Municipal de ${data.municipality}`,
       data.proposal_number || `PROP-${currentYear}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
       data.organ || '', data.process_link || '', data.responsible_name || req.user!.name,
       data.responsible_email || req.user!.email, data.responsible_phone || '', data.notes || '',
       req.user!.id, now, now, anoVal]
    );
    await addTimelineEvent(id, 'Demanda Cadastrada', `Demanda criada por ${req.user!.name}`, req.user!.name, data.status || 'pendente', 'created', {
      status: data.status || 'pendente', municipality: data.municipality, uf: data.uf, requested_value: data.requested_value || 0
    });
    await run(
      'UPDATE municipalities SET demands_count = demands_count + 1, total_value = total_value + $1, updated_at = NOW() WHERE name = $2 AND uf = $3',
      [data.requested_value || 0, data.municipality, data.uf]
    );
    await saveDemandVersion(id, { ...data, created_by: req.user!.id }, req.user!.id, req.user!.name, ip_address);
    const newDemand = await get('SELECT * FROM demands WHERE id = $1', [id]);
    await logAudit({
      entity_type: 'demand', entity_id: id, action: 'create',
      user_id: req.user!.id, user_name: req.user!.name,
      details: {
        entity_title: data.title,
        after: { status: data.status || 'pendente', priority: data.priority || 'media', municipality: data.municipality, uf: data.uf, value: data.requested_value || 0, organ: data.organ || '', responsible: data.responsible_name || req.user!.name }
      },
      ip_address, user_agent
    });
    clearCache('dashboard-stats');
    res.status(201).json(newDemand);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `"${e.path.join('.')}": ${e.message}`).join('; ');
      return res.status(400).json({ error: messages || 'Dados inválidos', details: error.errors });
    }
    logger.error('Create demand error', { error });
    res.status(500).json({ error: 'Erro ao criar demanda' });
  }
});

router.put('/:id', authenticateToken, requirePermission('demands.edit'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    if (req.user!.role === 'consulta') {
      return res.status(403).json({ error: 'Consulta não pode editar demandas' });
    }
    const existing = await get('SELECT * FROM demands WHERE id = $1 AND deleted_at IS NULL', [req.params.id as string]);
    if (!existing) return res.status(404).json({ error: 'Demanda não encontrada' });
    await saveDemandVersion(req.params.id as string, existing, req.user!.id, req.user!.name, ip_address);
    const data = normalizeDemandText(demandSchema.partial().parse(req.body));
    const result = buildUpdateQuery('demands', data, 'id', req.params.id as string);
    if (result) {
      await run(result.sql, result.values);
      const changedFields = Object.keys(data).filter(k => k !== 'status');
      if (data.status && data.status !== existing.status) {
        await logStatusChange(req.params.id as string, existing.status, data.status, req.user!.name);
      }
      if (changedFields.length > 0) {
        await addTimelineEvent(req.params.id as string, 'Demanda Editada',
          `Demanda editada por ${req.user!.name}${changedFields.length > 0 ? ` (campos: ${changedFields.join(', ')})` : ''}`,
          req.user!.name, data.status && data.status !== existing.status ? data.status : undefined,
          'updated', { changed: changedFields });
      }
    }
    const updated = await get('SELECT * FROM demands WHERE id = $1 AND deleted_at IS NULL', [req.params.id as string]);
    await logAudit({
      entity_type: 'demand', entity_id: req.params.id as string, action: 'update',
      user_id: req.user!.id, user_name: req.user!.name,
      details: {
        entity_title: existing.title,
        before: { status: existing.status, priority: existing.priority, municipality: existing.municipality, uf: existing.uf, value: existing.requested_value, organ: existing.organ, responsible: existing.responsible_name },
        after: { status: data.status || existing.status, priority: data.priority || existing.priority, municipality: data.municipality || existing.municipality, uf: data.uf || existing.uf, value: data.requested_value ?? existing.requested_value, organ: data.organ || existing.organ, responsible: data.responsible_name || existing.responsible_name },
        changed: Object.keys(data)
      },
      ip_address, user_agent
    });
    clearCache('dashboard-stats');
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `"${e.path.join('.')}": ${e.message}`).join('; ');
      return res.status(400).json({ error: messages || 'Dados inválidos', details: error.errors });
    }
    logger.error('Update demand error', { error });
    res.status(500).json({ error: 'Erro ao atualizar demanda' });
  }
});

router.delete('/:id', authenticateToken, requirePermission('demands.delete'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    if (req.user!.role !== 'admin' && req.user!.role !== 'gestor') {
      return res.status(403).json({ error: 'Sem permissão para excluir demandas' });
    }
    const demand = await get('SELECT * FROM demands WHERE id = $1 AND deleted_at IS NULL', [req.params.id as string]);
    if (!demand) return res.status(404).json({ error: 'Demanda não encontrada' });
    await run('UPDATE demands SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2', [req.user!.id, req.params.id as string]);
    await addTimelineEvent(req.params.id as string, 'Demanda Excluída', `Demanda excluída por ${req.user!.name}`, req.user!.name, demand.status, 'deleted', {
      status: demand.status, municipality: demand.municipality, uf: demand.uf
    });
    await run(
      'UPDATE municipalities SET demands_count = GREATEST(demands_count - 1, 0), total_value = GREATEST(total_value - $1, 0), updated_at = NOW() WHERE name = $2 AND uf = $3',
      [demand.requested_value, demand.municipality, demand.uf]
    );
    await logAudit({
      entity_type: 'demand', entity_id: req.params.id as string, action: 'delete',
      user_id: req.user!.id, user_name: req.user!.name,
      details: {
        entity_title: demand.title,
        before: { status: demand.status, priority: demand.priority, municipality: demand.municipality, uf: demand.uf, value: demand.requested_value, organ: demand.organ, responsible: demand.responsible_name }
      },
      ip_address, user_agent
    });
    clearCache('dashboard-stats');
    res.json({ message: 'Demanda removida com sucesso' });
  } catch (error) {
    logger.error('Delete demand error', { error });
    res.status(500).json({ error: 'Erro ao remover demanda' });
  }
});

router.post('/:id/restore', authenticateToken, requirePermission('demands.delete'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const demand = await get('SELECT * FROM demands WHERE id = $1 AND deleted_at IS NOT NULL', [req.params.id as string]);
    if (!demand) return res.status(404).json({ error: 'Demanda não encontrada ou não excluída' });
    await run('UPDATE demands SET deleted_at = NULL, deleted_by = NULL WHERE id = $1', [req.params.id as string]);
    await run(
      'UPDATE municipalities SET demands_count = demands_count + 1, total_value = total_value + $1, updated_at = NOW() WHERE name = $2 AND uf = $3',
      [demand.requested_value, demand.municipality, demand.uf]
    );
    await addTimelineEvent(req.params.id as string, 'Demanda Restaurada', `Demanda restaurada por ${req.user!.name}`, req.user!.name, demand.status, 'restored');
    await logAudit({
      entity_type: 'demand', entity_id: req.params.id as string, action: 'restore',
      user_id: req.user!.id, user_name: req.user!.name,
      details: {
        entity_title: demand.title,
        after: { status: demand.status, municipality: demand.municipality, uf: demand.uf, value: demand.requested_value }
      },
      ip_address, user_agent
    });
    res.json({ message: 'Demanda restaurada com sucesso' });
  } catch (error) {
    logger.error('Restore demand error', { error });
    res.status(500).json({ error: 'Erro ao restaurar demanda' });
  }
});

router.post('/:id/timeline', authenticateToken, requirePermission('demands.edit'), async (req: Request, res: Response) => {
  try {
    if (req.user!.role === 'consulta') {
      return res.status(403).json({ error: 'Seu perfil (Consulta) é somente leitura' });
    }
    const demand = await get('SELECT * FROM demands WHERE id = $1 AND deleted_at IS NULL', [req.params.id as string]);
    if (!demand) return res.status(404).json({ error: 'Demanda não encontrada' });
    const data = timelineEventSchema.parse(req.body);
    const eventId = await addTimelineEvent(req.params.id as string, data.title,
      data.description || 'Nenhuma descrição informada.', req.user!.name,
      data.status_changed_to,
      data.status_changed_to ? 'status_changed' : 'note',
      data.status_changed_to ? { from: demand.status, to: data.status_changed_to } : null);
    if (data.status_changed_to) {
      await run('UPDATE demands SET status = $1, updated_at = NOW() WHERE id = $2', [data.status_changed_to, req.params.id as string]);
      if (data.status_changed_to === 'concluido') {
        await addTimelineEvent(req.params.id as string, 'Demanda Concluída',
          `Demanda concluída por ${req.user!.name}`,
          req.user!.name, 'concluido', 'concluded', { from: demand.status, to: 'concluido' });
      }
    }
    const event = await get('SELECT * FROM timeline_events WHERE id = $1', [eventId]);
    res.status(201).json(event);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    logger.error('Add timeline event error', { error });
    res.status(500).json({ error: 'Erro ao adicionar evento' });
  }
});

export default router;

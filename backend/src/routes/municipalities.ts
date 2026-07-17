import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { get, all, run } from '../database.js';
import { authenticateToken, requireRole, optionalAuth } from '../middleware/auth.js';

const router = Router();

const municipalitySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  uf: z.string().length(2, 'UF deve ter 2 caracteres'),
  schools_count: z.number().optional(),
  population: z.number().optional(),
  hdi: z.number().min(0).max(1).optional(),
  region: z.enum(['Norte', 'Nordeste', 'Sudeste', 'Sul', 'Centro-Oeste']).optional()
});

router.get('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { uf, region, search } = req.query;
    let sql = 'SELECT * FROM municipalities WHERE 1=1';
    const params: any[] = [];

    if (uf && uf !== 'all') { sql += ' AND uf = $' + (params.length + 1); params.push(uf); }
    if (region && region !== 'all') { sql += ' AND region = $' + (params.length + 1); params.push(region); }
    if (search) {
      sql += ' AND (name ILIKE $' + (params.length + 1) + ' OR uf ILIKE $' + (params.length + 2) + ')';
      const t = `%${search}%`;
      params.push(t, t);
    }
    sql += ' ORDER BY name ASC';

    const municipalities = await all(sql, params);
    res.json(municipalities);
  } catch (error) {
    console.error('Get municipalities error:', error);
    res.status(500).json({ error: 'Erro ao buscar municípios' });
  }
});

router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    const municipality = await get('SELECT * FROM municipalities WHERE id = $1', [req.params.id]);
    if (!municipality) return res.status(404).json({ error: 'Município não encontrado' });

    const demands = await all(
      'SELECT * FROM demands WHERE municipality = (SELECT name FROM municipalities WHERE id = $1) AND uf = (SELECT uf FROM municipalities WHERE id = $1)',
      [req.params.id]
    );

    res.json({ ...municipality, demands });
  } catch (error) {
    console.error('Get municipality error:', error);
    res.status(500).json({ error: 'Erro ao buscar município' });
  }
});

router.post('/', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const data = municipalitySchema.parse(req.body);
    const existing = await get('SELECT id FROM municipalities WHERE name = $1 AND uf = $2', [data.name, data.uf]);

    if (existing) return res.status(409).json({ error: 'Município já cadastrado' });

    const result = await run(
      `INSERT INTO municipalities (name, uf, schools_count, population, hdi, region)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.name, data.uf, data.schools_count || 0, data.population || 0, data.hdi || 0, data.region || 'Sudeste']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    console.error('Create municipality error:', error);
    res.status(500).json({ error: 'Erro ao criar município' });
  }
});

router.put('/:id', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const existing = await get('SELECT * FROM municipalities WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Município não encontrado' });

    const data = municipalitySchema.partial().parse(req.body);
    const result = await run(
      `UPDATE municipalities SET name = COALESCE($1, name), uf = COALESCE($2, uf),
       schools_count = COALESCE($3, schools_count), population = COALESCE($4, population),
       hdi = COALESCE($5, hdi), region = COALESCE($6, region), updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [data.name, data.uf, data.schools_count, data.population, data.hdi, data.region, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    console.error('Update municipality error:', error);
    res.status(500).json({ error: 'Erro ao atualizar município' });
  }
});

router.delete('/:id', authenticateToken, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const municipality = await get('SELECT * FROM municipalities WHERE id = $1', [req.params.id]);
    if (!municipality) return res.status(404).json({ error: 'Município não encontrado' });

    const demandsCount = await get<{ count: string }>(
      'SELECT COUNT(*) as count FROM demands WHERE municipality = (SELECT name FROM municipalities WHERE id = $1)',
      [req.params.id]
    );

    if (demandsCount && parseInt(demandsCount.count) > 0) {
      return res.status(400).json({ error: 'Não é possível remover município com demandas vinculadas' });
    }

    await run('DELETE FROM municipalities WHERE id = $1', [req.params.id]);
    res.json({ message: 'Município removido com sucesso' });
  } catch (error) {
    console.error('Delete municipality error:', error);
    res.status(500).json({ error: 'Erro ao remover município' });
  }
});

router.get('/stats/by-region', optionalAuth, async (req: Request, res: Response) => {
  try {
    const stats = await all(`
      SELECT region, COUNT(*) as count, SUM(total_value) as total_value, AVG(hdi) as avg_hdi
      FROM municipalities GROUP BY region ORDER BY count DESC
    `);
    res.json(stats);
  } catch (error) {
    console.error('Municipality stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

export default router;
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../database.js';
import { MunicipalityData } from '../types.js';
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

// Get all municipalities
router.get('/', optionalAuth, (req: Request, res: Response) => {
  try {
    const { uf, region, search } = req.query;

    let query = 'SELECT * FROM municipalities WHERE 1=1';
    const params: any[] = [];

    if (uf && uf !== 'all') {
      query += ' AND uf = ?';
      params.push(uf);
    }

    if (region && region !== 'all') {
      query += ' AND region = ?';
      params.push(region);
    }

    if (search) {
      query += ' AND (name LIKE ? OR uf LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY name ASC';

    const municipalities = db.prepare(query).all(...params);

    res.json(municipalities);
  } catch (error) {
    console.error('Get municipalities error:', error);
    res.status(500).json({ error: 'Erro ao buscar municípios' });
  }
});

// Get single municipality with its demands
router.get('/:id', optionalAuth, (req: Request, res: Response) => {
  try {
    const municipality = db.prepare('SELECT * FROM municipalities WHERE id = ?').get(req.params.id);

    if (!municipality) {
      return res.status(404).json({ error: 'Município não encontrado' });
    }

    const demands = db.prepare(
      'SELECT * FROM demands WHERE municipality = ? AND uf = (SELECT uf FROM municipalities WHERE id = ?)'
    ).all(req.params.id, req.params.id);

    res.json({
      ...municipality,
      demands
    });
  } catch (error) {
    console.error('Get municipality error:', error);
    res.status(500).json({ error: 'Erro ao buscar município' });
  }
});

// Create municipality (admin only)
router.post('/', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const data = municipalitySchema.parse(req.body);

    const existing = db.prepare(
      'SELECT id FROM municipalities WHERE name = ? AND uf = ?'
    ).get(data.name, data.uf);

    if (existing) {
      return res.status(409).json({ error: 'Município já cadastrado' });
    }

    const result = db.prepare(`
      INSERT INTO municipalities (name, uf, schools_count, population, hdi, region)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.name,
      data.uf,
      data.schools_count || 0,
      data.population || 0,
      data.hdi || 0,
      data.region || 'Sudeste'
    );

    const municipality = db.prepare('SELECT * FROM municipalities WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json(municipality);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Create municipality error:', error);
    res.status(500).json({ error: 'Erro ao criar município' });
  }
});

// Update municipality (admin only)
router.put('/:id', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM municipalities WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Município não encontrado' });
    }

    const data = municipalitySchema.partial().parse(req.body);

    db.prepare(`
      UPDATE municipalities SET
        name = COALESCE(?, name),
        uf = COALESCE(?, uf),
        schools_count = COALESCE(?, schools_count),
        population = COALESCE(?, population),
        hdi = COALESCE(?, hdi),
        region = COALESCE(?, region),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      data.name,
      data.uf,
      data.schools_count,
      data.population,
      data.hdi,
      data.region,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM municipalities WHERE id = ?').get(req.params.id);

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Update municipality error:', error);
    res.status(500).json({ error: 'Erro ao atualizar município' });
  }
});

// Delete municipality (admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const municipality = db.prepare('SELECT * FROM municipalities WHERE id = ?').get(req.params.id);

    if (!municipality) {
      return res.status(404).json({ error: 'Município não encontrado' });
    }

    // Check if municipality has demands
    const demandsCount = db.prepare(
      'SELECT COUNT(*) as count FROM demands WHERE municipality = (SELECT name FROM municipalities WHERE id = ?)'
    ).get(req.params.id) as { count: number };

    if (demandsCount.count > 0) {
      return res.status(400).json({ 
        error: 'Não é possível remover município com demandas vinculadas' 
      });
    }

    db.prepare('DELETE FROM municipalities WHERE id = ?').run(req.params.id);

    res.json({ message: 'Município removido com sucesso' });
  } catch (error) {
    console.error('Delete municipality error:', error);
    res.status(500).json({ error: 'Erro ao remover município' });
  }
});

// Get municipality stats by region
router.get('/stats/by-region', optionalAuth, (req: Request, res: Response) => {
  try {
    const stats = db.prepare(`
      SELECT 
        region,
        COUNT(*) as count,
        SUM(total_value) as total_value,
        AVG(hdi) as avg_hdi
      FROM municipalities
      GROUP BY region
      ORDER BY count DESC
    `).all();

    res.json(stats);
  } catch (error) {
    console.error('Municipality stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

export default router;
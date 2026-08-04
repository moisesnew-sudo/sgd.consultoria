import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { all } from '../database.js';
import { logger } from '../lib/logger.js';
import { suggestMunicipalities } from '../lib/text.js';
import { buildStandardizationScan, applyStandardizationScan } from '../lib/standardization.js';

const router = Router();

// Sugestões oficiais do IBGE para autocompletar (busca por prefixo, sem acento/caixa).
router.get('/municipalities', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { q, uf } = req.query;
    const data = suggestMunicipalities(q, uf, 25);
    res.json({ data, count: data.length });
  } catch (error) {
    logger.error('IBGE suggestions error', { error });
    res.status(500).json({ error: 'Erro ao buscar sugestões de municípios' });
  }
});

// Sugestão de objetos (títulos) já cadastrados — reutilização no autocomplete.
router.get('/objects', authenticateToken, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    const params: any[] = [];
    let sql = 'SELECT DISTINCT title FROM demands WHERE deleted_at IS NULL';
    if (q) {
      sql += ' AND title ILIKE $1';
      params.push(`%${q}%`);
    }
    sql += ' ORDER BY title ASC LIMIT 15';
    const rows = await all<{ title: string }>(sql, params);
    const data = rows.map(r => r.title).filter(Boolean);
    res.json({ data, count: data.length });
  } catch (error) {
    logger.error('Objects suggestions error', { error });
    res.status(500).json({ error: 'Erro ao buscar sugestões de objetos' });
  }
});

// Relatório de padronização (somente leitura).
router.post('/scan', authenticateToken, requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const report = await buildStandardizationScan();
    res.json(report);
  } catch (error) {
    logger.error('Standardization scan error', { error });
    res.status(500).json({ error: 'Erro ao gerar relatório de padronização' });
  }
});

// Aplica a padronização/correção nos dados existentes.
router.post('/apply', authenticateToken, requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const report = await applyStandardizationScan();
    res.json(report);
  } catch (error) {
    logger.error('Standardization apply error', { error });
    res.status(500).json({ error: 'Erro ao aplicar padronização' });
  }
});

export default router;
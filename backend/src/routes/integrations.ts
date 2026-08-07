import { Router, Request, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { getAll, getById, create, update, setActive } from '../lib/integrationSystems.js';
import { logger } from '../lib/logger.js';
import { z } from 'zod';

const router = Router();

const ENDPOINTS = [
  { method: 'POST', path: '/api/auth/login', auth: false, desc: 'Autenticar e obter token JWT' },
  { method: 'GET', path: '/api/demands', auth: true, desc: 'Listar demandas (filtros: status, priority, uf, category, search)' },
  { method: 'GET', path: '/api/demands/:id', auth: true, desc: 'Detalhe de uma demanda (inclui timeline, anexos, comentários)' },
  { method: 'POST', path: '/api/demands', auth: true, desc: 'Criar demanda' },
  { method: 'PUT', path: '/api/demands/:id', auth: true, desc: 'Atualizar demanda' },
  { method: 'DELETE', path: '/api/demands/:id', auth: true, desc: 'Remover demanda' },
  { method: 'POST', path: '/api/demands/:id/timeline', auth: true, desc: 'Adicionar trâmite' },
  { method: 'GET', path: '/api/demands/:id/comments', auth: true, desc: 'Listar comentários' },
  { method: 'POST', path: '/api/demands/:id/comments', auth: true, desc: 'Comentar' },
  { method: 'GET', path: '/api/demands/calendar/events', auth: true, desc: 'Eventos para calendário' },
  { method: 'GET', path: '/api/municipalities', auth: true, desc: 'Listar municípios' },
  { method: 'GET', path: '/api/audit', auth: true, desc: 'Trilha de auditoria (admin)' },
  { method: 'GET', path: '/api/health', auth: false, desc: 'Status do serviço' },
];

router.get('/', authenticateToken, requirePermission('integrations.view'), (req: Request, res: Response) => {
  const baseUrl = process.env.PUBLIC_API_URL || (req.get('host') ? `${req.protocol}://${req.get('host')}/api` : 'https://api.gruposgd.com.br/api');
  res.json({
    baseUrl,
    authHeader: 'Authorization: Bearer <seu_token_jwt>',
    note: 'Para integrações servidor-a-servidor, configure API_TOKEN_SECRET no ambiente e gere tokens via painel administrativo.',
    endpoints: ENDPOINTS,
    webhookSample: {
      event: 'demand.created',
      payload: { id: 'SGD-2026-001', municipality: 'EXEMPLO', uf: 'BA', status: 'pendente' }
    }
  });
});

/**
 * GET /api/integrations/systems
 * Listar sistemas de integração
 * Permissão: admin
 * Query params: page, limit, search, active
 */
router.get('/systems', authenticateToken, requirePermission('integrations.view'), async (req: Request, res: Response) => {
  try {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const active = req.query.active !== undefined ? String(req.query.active) === 'true' : undefined;

    const result = await getAll({ page, limit, search, active });

    res.json({
      data: result.data,
      pagination: {
        page: page ?? 1,
        limit: limit ?? 20,
        total: result.total,
        totalPages: Math.ceil(result.total / (limit ?? 20)),
      },
    });
  } catch (error) {
    logger.error('Erro ao listar sistemas de integração', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao listar sistemas' });
  }
});

/**
 * GET /api/integrations/systems/:id
 * Detalhar sistema de integração
 * Permissão: admin
 */
router.get('/systems/:id', authenticateToken, requirePermission('integrations.view'), async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const system = await getById(id);

    if (!system) {
      return res.status(404).json({ error: 'Sistema não encontrado' });
    }

    res.json(system);
  } catch (error) {
    logger.error('Erro ao buscar sistema de integração', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao buscar sistema' });
  }
});

/**
 * POST /api/integrations/systems
 * Criar sistema de integração
 * Permissão: admin + CSRF
 */
router.post('/systems', authenticateToken, requirePermission('integrations.manage'), csrfProtection, async (req: Request, res: Response) => {
  try {
    const system = await create(req.body, req.user);

    res.status(201).json(system);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error instanceof Error) {
      if (error.message.includes('Já existe um sistema com este code') || error.message.includes('Code é obrigatório') || error.message.includes('Nome é obrigatório') || error.message.includes('Variável de ambiente')) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message.includes('JSON') || error.message.includes('config')) {
        return res.status(400).json({ error: 'Config deve ser um JSON válido' });
      }
    }
    logger.error('Erro ao criar sistema de integração', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao criar sistema' });
  }
});

/**
 * PUT /api/integrations/systems/:id
 * Atualizar sistema de integração
 * Permissão: admin + CSRF
 */
router.put('/systems/:id', authenticateToken, requirePermission('integrations.manage'), csrfProtection, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const system = await update(id, req.body, req.user);

    res.json(system);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error instanceof Error) {
      if (error.message === 'Sistema não encontrado') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('JSON') || error.message.includes('config')) {
        return res.status(400).json({ error: 'Config deve ser um JSON válido' });
      }
      if (error.message.includes('Nome é obrigatório')) {
        return res.status(400).json({ error: 'Nome é obrigatório' });
      }
    }
    logger.error('Erro ao atualizar sistema de integração', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao atualizar sistema' });
  }
});

/**
 * PATCH /api/integrations/systems/:id/activate
 * Ativar sistema de integração
 * Permissão: admin + CSRF
 */
router.patch('/systems/:id/activate', authenticateToken, requirePermission('integrations.manage'), csrfProtection, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const system = await setActive(id, true, req.user);

    res.json(system);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error instanceof Error && error.message === 'Sistema não encontrado') {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Erro ao ativar sistema de integração', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao ativar sistema' });
  }
});

/**
 * PATCH /api/integrations/systems/:id/deactivate
 * Desativar sistema de integração
 * Permissão: admin + CSRF
 */
router.patch('/systems/:id/deactivate', authenticateToken, requirePermission('integrations.manage'), csrfProtection, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const system = await setActive(id, false, req.user);

    res.json(system);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error instanceof Error && error.message === 'Sistema não encontrado') {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Erro ao desativar sistema de integração', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao desativar sistema' });
  }
});

export default router;
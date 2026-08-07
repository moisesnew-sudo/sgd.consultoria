import { Router, Request, Response } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import {
  getDashboard,
  getHealthList,
  getLogs,
  getSystemDetail,
  runManualSync,
  listAdapters,
} from '../lib/integrationAdmin.js';
import { logger } from '../lib/logger.js';

/**
 * Backend administrativo de integrações (Fase 3.1 — Fase B).
 * Todas as rotas exigem JWT (authenticateToken) e permissão específica:
 * - consultas  → integrations.view
 * - alterações → integrations.manage
 * - sincronização → integrations.sync (+ CSRF)
 * Todas as ações administrativas geram auditoria (via lib).
 */

const router = Router();

function parseIntParam(value: unknown): number | undefined {
  const n = typeof value === 'string' ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** GET /api/integrations/admin/dashboard */
router.get('/admin/dashboard', authenticateToken, requirePermission('integrations.view'), async (_req: Request, res: Response) => {
  try {
    res.json(await getDashboard());
  } catch (error) {
    logger.error('Erro ao buscar dashboard de integrações', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao buscar dashboard de integrações' });
  }
});

/** GET /api/integrations/admin/health */
router.get('/admin/health', authenticateToken, requirePermission('integrations.view'), async (_req: Request, res: Response) => {
  try {
    res.json(await getHealthList());
  } catch (error) {
    logger.error('Erro ao buscar saúde das integrações', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao buscar saúde das integrações' });
  }
});

/** GET /api/integrations/admin/logs */
router.get('/admin/logs', authenticateToken, requirePermission('integrations.view'), async (req: Request, res: Response) => {
  try {
    const filters = {
      page: parseIntParam(req.query.page),
      limit: parseIntParam(req.query.limit),
      systemId: parseIntParam(req.query.system),
      systemCode: req.query.systemCode ? String(req.query.systemCode) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      direction: req.query.direction ? String(req.query.direction) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      hasError: req.query.error === 'true' || req.query.hasError === 'true',
      search: req.query.search ? String(req.query.search) : undefined,
    };
    res.json(await getLogs(filters));
  } catch (error) {
    logger.error('Erro ao buscar histórico de execuções', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao buscar histórico de execuções' });
  }
});

/** GET /api/integrations/admin/systems/:id */
router.get('/admin/systems/:id', authenticateToken, requirePermission('integrations.view'), async (req: Request, res: Response) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === undefined || Number.isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const detail = await getSystemDetail(id);
    if (!detail) {
      return res.status(404).json({ error: 'Sistema não encontrado' });
    }
    res.json(detail);
  } catch (error) {
    logger.error('Erro ao buscar detalhes do sistema de integração', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao buscar detalhes do sistema' });
  }
});

/** GET /api/integrations/admin/adapters */
router.get('/admin/adapters', authenticateToken, requirePermission('integrations.view'), async (_req: Request, res: Response) => {
  try {
    res.json({ data: listAdapters() });
  } catch (error) {
    logger.error('Erro ao listar adapters', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao listar adapters' });
  }
});

/** POST /api/integrations/admin/systems/:id/sync */
router.post('/admin/systems/:id/sync', authenticateToken, requirePermission('integrations.sync'), csrfProtection, async (req: Request, res: Response) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === undefined || Number.isNaN(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const payload = req.body?.payload;
    const result = await runManualSync(id, req.user, payload, req);
    res.json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Sistema não encontrado') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('inativo') || error.message.includes('Payload') || error.message.includes('adapter registrado')) {
        return res.status(400).json({ error: error.message });
      }
    }
    logger.error('Erro na sincronização manual', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro na sincronização manual' });
  }
});

export default router;

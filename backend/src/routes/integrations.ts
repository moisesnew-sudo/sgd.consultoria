import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';

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

router.get('/', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  const baseUrl = process.env.PUBLIC_API_URL || (req.get('host') ? `${req.protocol}://${req.get('host')}/api` : 'https://sgd-consultoria.onrender.com/api');
  // ✅ CORREÇÃO: Não expõe derivado do JWT_SECRET
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

export default router;

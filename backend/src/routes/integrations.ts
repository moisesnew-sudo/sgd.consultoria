import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

// Public documentation of integration endpoints
const ENDPOINTS = [
  { method: 'POST', path: '/api/auth/login', auth: false, desc: 'Autenticar e obter token JWT' },
  { method: 'GET', path: '/api/demands', auth: true, desc: 'Listar demandas (filtros: status, priority, uf, category, search)' },
  { method: 'GET', path: '/api/demands/:id', auth: false, desc: 'Detalhe de uma demanda (inclui timeline, anexos, comentários)' },
  { method: 'POST', path: '/api/demands', auth: true, desc: 'Criar demanda' },
  { method: 'PUT', path: '/api/demands/:id', auth: true, desc: 'Atualizar demanda' },
  { method: 'DELETE', path: '/api/demands/:id', auth: true, desc: 'Remover demanda' },
  { method: 'POST', path: '/api/demands/:id/timeline', auth: true, desc: 'Adicionar trâmite' },
  { method: 'GET', path: '/api/demands/:id/comments', auth: true, desc: 'Listar comentários' },
  { method: 'POST', path: '/api/demands/:id/comments', auth: true, desc: 'Comentar' },
  { method: 'GET', path: '/api/demands/calendar/events', auth: false, desc: 'Eventos para calendário' },
  { method: 'GET', path: '/api/municipalities', auth: false, desc: 'Listar municípios' },
  { method: 'GET', path: '/api/audit', auth: true, desc: 'Trilha de auditoria (admin)' },
  { method: 'GET', path: '/api/health', auth: false, desc: 'Status do serviço' },
];

// Get integration info + API token (admin)
router.get('/', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  const baseUrl = process.env.PUBLIC_API_URL || (req.get('host') ? `${req.protocol}://${req.get('host')}/api` : 'https://sgd-consultoria.onrender.com/api');
  const apiToken = `sgd_api_${Buffer.from(process.env.JWT_SECRET || 'secret').toString('base64').slice(0, 24)}`;
  res.json({
    baseUrl,
    authHeader: 'Authorization: Bearer <seu_token_jwt>',
    apiToken,
    note: 'Use o apiToken como Bearer para integrações servidor-a-servidor. Gere um novo ao rotacionar JWT_SECRET.',
    endpoints: ENDPOINTS,
    webhookSample: {
      event: 'demand.created',
      payload: { id: 'SGD-2026-001', municipality: 'EXEMPLO', uf: 'BA', status: 'pendente' }
    }
  });
});

export default router;

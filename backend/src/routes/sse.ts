/**
 * Fase D1.5b — Rota SSE da Central de Integrações.
 *
 * Endpoint: GET /api/events/integrations
 *
 * Transmit eventos de integração em tempo real para usuários autorizados.
 * Reutiliza o eventBus singleton da D1.5a.
 *
 * Autenticação: JWT via cookie ou Authorization header.
 * Autorização: permissão integrations.view.
 *
 * F2.1 — Hardening de produção:
 * - Limite máximo de conexões simultâneas (anti-exaustão de memória);
 * - Contador global de conexões ativas (Set<Response>);
 * - Renovação de autenticação: encerra conexão próxima ao vencimento do JWT
 *   e envia evento `sse:reconnect` para o cliente reconectar com token novo;
 * - closeAllSSEClients() para encerramento controlado no graceful shutdown.
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { onIntegrationEvent, offIntegrationEvent } from '../lib/eventBus.js';
import type { IntegrationEventName } from '../lib/eventBus.js';
import { logger } from '../lib/logger.js';
import {
  recordSSEConnect,
  recordSSEDisconnect,
  recordSSERefused,
  setSSEMaxConnections,
  incrementSSEEventsSent,
} from '../lib/healthStatus.js';

const router = Router();

const HEARTBEAT_INTERVAL_MS = 30_000;
const SSE_RETRY_MS = 30_000;

/** Nome do evento enviado quando o cliente deve renovar o token e reconectar. */
export const SSE_RECONNECT_EVENT = 'sse:reconnect';

/**
 * Limite máximo de conexões SSE simultâneas. Re-lido por requisição para
 * permitir ajuste em runtime (env) e testes determinísticos.
 */
function getSseMaxConnections(): number {
  const n = parseInt(process.env.SSE_MAX_CONNECTIONS || '100', 10);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

/**
 * Margem (ms) antes do vencimento do JWT para encerrar a conexão SSE e pedir
 * reconexão. Garante que a conexão nunca sobreviva ao token que a autoriza.
 */
function getTokenRenewMarginMs(): number {
  const n = parseInt(process.env.SSE_TOKEN_RENEW_MARGIN_MS || '30000', 10);
  return Number.isFinite(n) && n >= 0 ? n : 30000;
}

/** Conexões SSE ativas — fonte de verdade para limite e shutdown. */
const activeSSEClients = new Set<Response>();

/**
 * Contador global de conexões ativas (equivalente ao healthStatus,
 * mantido de forma atômica para decisões síncronas no handler).
 */
export function getActiveSSECount(): number {
  return activeSSEClients.size;
}

/**
 * Extrai o exp (epoch ms) do JWT já verificado pelo authenticateToken.
 * Retorna null quando o token não está presente ou não é decodificável.
 */
function getTokenExpiryMs(req: Request): number | null {
  const token =
    req.cookies?.token ||
    (typeof req.headers.authorization === 'string' ? req.headers.authorization.split(' ')[1] : undefined);
  if (!token) return null;
  try {
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === 'object' && 'exp' in decoded) {
      const exp = (decoded as jwt.JwtPayload).exp;
      if (typeof exp === 'number') return exp * 1000;
    }
  } catch {
    /* token não decodificável — conexão segue sem timer de renovação */
  }
  return null;
}

const SSE_EVENTS: IntegrationEventName[] = [
  'integration:created',
  'integration:updated',
  'integration:toggled',
  'integration:synced',
  'integration:health',
  'integration:log',
  'integration:alert',
  'demand:created',
  'demand:updated',
  'demand:status_changed',
  'demand:deleted',
  'comment:created',
];

router.get(
  '/events/integrations',
  authenticateToken,
  requirePermission('integrations.view'),
  (req: Request, res: Response) => {
    const userId = req.user?.id ?? 'unknown';

    // ---- F2.1: Limite de conexões simultâneas (anti-exaustão) ----
    const maxConnections = getSseMaxConnections();
    setSSEMaxConnections(maxConnections);

    if (activeSSEClients.size >= maxConnections) {
      recordSSERefused();
      logger.warn('SSE: conexão recusada — limite de conexões atingido', {
        userId,
        active: activeSSEClients.size,
        max: maxConnections,
      });
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ error: 'Limite de conexões SSE atingido. Tente novamente em instantes.' });
    }

    const tokenExpiryMs = getTokenExpiryMs(req);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`retry: ${SSE_RETRY_MS}\n\n`);

    const listenerIds: string[] = [];

    for (const eventName of SSE_EVENTS) {
      const id = onIntegrationEvent(eventName, (payload) => {
        try {
          res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
          incrementSSEEventsSent();
        } catch {
          close();
        }
      });
      listenerIds.push(id);
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(`:\n\n`);
      } catch {
        close();
      }
    }, HEARTBEAT_INTERVAL_MS);

    let tokenTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function close(reason?: string): void {
      if (closed) return;
      closed = true;

      clearInterval(heartbeat);
      if (tokenTimer) clearTimeout(tokenTimer);
      tokenTimer = null;

      for (const id of listenerIds) {
        offIntegrationEvent(id);
      }
      listenerIds.length = 0;

      activeSSEClients.delete(res);

      try { res.end(); } catch { /* ignore */ }
      recordSSEDisconnect();
      logger.debug('SSE client disconnected', { userId, reason });
    }

    // ---- F2.1: Renovação de autenticação — encerra antes do vencimento ----
    if (tokenExpiryMs) {
      const delayMs = Math.max(0, tokenExpiryMs - Date.now() - getTokenRenewMarginMs());
      tokenTimer = setTimeout(() => {
        logger.info('SSE: conexão encerrada — token próximo ao vencimento', { userId });
        try {
          res.write(`event: ${SSE_RECONNECT_EVENT}\ndata: ${JSON.stringify({ reason: 'token_expiring', retryMs: SSE_RETRY_MS })}\n\n`);
        } catch { /* ignore */ }
        close('token_expiring');
      }, delayMs);
    }

    req.on('close', () => {
      close('client_disconnect');
    });

    activeSSEClients.add(res);
    recordSSEConnect();
    logger.debug('SSE client connected', { userId });
  },
);

/**
 * F2.1 — Encerra todas as conexões SSE ativas.
 * Usado no graceful shutdown para liberar recursos e sinalizar reconexão.
 */
export function closeAllSSEClients(reason = 'server_shutdown'): void {
  const count = activeSSEClients.size;
  if (count === 0) return;

  logger.info('SSE: encerrando conexões ativas', { count, reason });

  for (const res of activeSSEClients) {
    try {
      res.write(`event: ${SSE_RECONNECT_EVENT}\ndata: ${JSON.stringify({ reason, retryMs: SSE_RETRY_MS })}\n\n`);
    } catch { /* ignore */ }
    try { res.end(); } catch { /* ignore */ }
  }
}

export default router;

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { get } from '../database.js';
import { logger } from '../lib/logger.js';

export interface IntegrationSystem {
  id: number;
  code: string;
  name: string;
  secret_env_key: string;
  active: boolean;
}

declare global {
  namespace Express {
    interface Request {
      integrationSystem?: IntegrationSystem;
    }
  }
}

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const MIN_SECRET_LENGTH = 16;
const SYSTEM_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,49}$/;

/**
 * Autenticação de webhooks de sistemas externos (Transferegov, SEI, CGLOG).
 * - Sistema identificado pela URL (:system) e registrado em integration_systems;
 * - Assinatura HMAC-SHA256 (header X-Signature) sobre `timestamp\n[chave-idempotencia]\nbody`;
 * - Header X-Timestamp valida janela anti-replay (5 min);
 * - Segredo lido de process.env via secret_env_key (nunca armazenado no banco);
 * - Sem JWT/sessão/CSRF.
 */
export async function authenticateWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const systemCode = String(req.params.system || '').toLowerCase().trim();
    if (!SYSTEM_CODE_RE.test(systemCode)) {
      return res.status(401).json({ error: 'Sistema de integração inválido' });
    }

    const system = await get<IntegrationSystem>(
      'SELECT id, code, name, secret_env_key, active FROM integration_systems WHERE code = $1 AND active = TRUE',
      [systemCode]
    );
    if (!system) {
      return res.status(401).json({ error: 'Sistema de integração inválido ou inativo' });
    }

    const signature = req.headers['x-signature'];
    if (typeof signature !== 'string' || signature.trim() === '') {
      return res.status(401).json({ error: 'Assinatura ausente (header X-Signature)' });
    }

    const timestampRaw = req.headers['x-timestamp'];
    const timestamp = typeof timestampRaw === 'string' ? Number(timestampRaw) : NaN;
    if (!Number.isFinite(timestamp)) {
      return res.status(401).json({ error: 'Timestamp ausente ou inválido (header X-Timestamp)' });
    }
    if (Math.abs(Date.now() - timestamp) > REPLAY_WINDOW_MS) {
      return res.status(401).json({ error: 'Timestamp fora da janela de validade (possível replay)' });
    }

    const secret = process.env[system.secret_env_key];
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      logger.error('Webhook secret não configurado', {
        system: system.code,
        secret_env_key: system.secret_env_key,
      });
      return res.status(401).json({ error: 'Sistema de integração não configurado' });
    }

    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const idempotencyKey = req.headers['x-idempotency-key'];
    const tsPart = Buffer.from(`${timestamp}\n`, 'utf8');
    const keyPart = idempotencyKey ? Buffer.from(`${String(idempotencyKey)}\n`, 'utf8') : Buffer.alloc(0);

    const expected = crypto.createHmac('sha256', secret)
      .update(tsPart)
      .update(keyPart)
      .update(rawBody)
      .digest();

    const receivedHex = String(signature).toLowerCase();
    const received = Buffer.from(receivedHex, 'hex');
    const valid = received.length === expected.length && crypto.timingSafeEqual(received, expected);
    if (!valid) {
      return res.status(401).json({ error: 'Assinatura inválida' });
    }

    req.integrationSystem = system;
    next();
  } catch (err) {
    next(err);
  }
}

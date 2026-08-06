import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { get, run } from '../database.js';
import { authenticateWebhook } from '../middleware/webhookAuth.js';
import { logger } from '../lib/logger.js';
import { processWebhookEvent } from '../lib/integrationProcessor.js';

const router = Router();

const HEADER_LOG_KEYS = ['x-signature', 'x-timestamp', 'x-idempotency-key', 'content-type'];

function pickHeaders(headers: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of HEADER_LOG_KEYS) {
    const value = headers?.[key];
    if (value !== undefined) {
      out[key] = typeof value === 'string' ? value : String(value);
    }
  }
  return out;
}

function parsePayload(rawBody: Buffer, contentType: string): { payload: any; eventType: string } {
  if (contentType.includes('json') && rawBody.length > 0) {
    try {
      const parsed = JSON.parse(rawBody.toString('utf8'));
      const eventType = typeof parsed?.event === 'string' && parsed.event.trim()
        ? parsed.event.trim().slice(0, 100)
        : 'unknown';
      return { payload: parsed, eventType };
    } catch {
      return { payload: { raw_body: rawBody.toString('utf8').slice(0, 10000) }, eventType: 'invalid_json' };
    }
  }
  return { payload: { raw_body: rawBody.toString('utf8').slice(0, 10000) }, eventType: 'unknown' };
}

/**
 * POST /api/integrations/webhooks/:system
 * Recebe eventos de sistemas governamentais com autenticação HMAC.
 * - Idempotente: idempotency_key única (header X-Idempotency-Key ou SHA-256 do payload);
 * - Sempre responde 200 quando o evento é validado (duplicatas também respondem 200);
 * - Persiste em webhook_events e registra em integration_logs.
 */
router.post('/:system', authenticateWebhook, async (req: Request, res: Response) => {
  try {
    const system = req.integrationSystem!;
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const { payload, eventType } = parsePayload(rawBody, contentType);

    const headerKey = req.headers['x-idempotency-key'];
    const idempotencyKey = headerKey
      ? `${system.code}:${String(headerKey).slice(0, 200)}`
      : `${system.code}:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
    const safeKey = idempotencyKey.slice(0, 255);

    const signature = req.headers['x-signature'];
    const ip = req.headers['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : req.socket?.remoteAddress || 'unknown';

    const inserted = await run(
      `INSERT INTO webhook_events
         (system_id, system_code, event_type, idempotency_key, payload, headers, signature, received_ip, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        system.id, system.code, eventType, safeKey,
        JSON.stringify(payload),
        JSON.stringify(pickHeaders(req.headers)),
        typeof signature === 'string' ? signature : '',
        ip,
      ]
    );

    const isDuplicate = !inserted.rows?.[0]?.id;
    const eventId = isDuplicate
      ? await get<{ id: number }>(
          'SELECT id FROM webhook_events WHERE system_id = $1 AND idempotency_key = $2',
          [system.id, safeKey]
        ).then(r => r?.id || null)
      : inserted.rows[0].id;

    await run(
      `INSERT INTO integration_logs (system_id, system_code, direction, action, webhook_event_id, status, message)
       VALUES ($1, $2, 'in', 'webhook.received', $3, $4, $5)`,
      [
        system.id, system.code, eventId,
        isDuplicate ? 'warning' : 'success',
        isDuplicate
          ? 'Evento duplicado ignorado (idempotency key repetida)'
          : `Evento ${eventType} recebido (aguardando processamento)`,
      ]
    );

    // Processamento imediato (Fase 2.2.2): eventos novos são sincronizados na
    // hora; duplicatas nunca reprocessam. Falha aqui NÃO derruba o 200 —
    // o evento permanece 'pending' para retentativa manual/automática.
    let processing: { status: string; reason?: string } | undefined;
    if (!isDuplicate && eventId) {
      try {
        const result = await processWebhookEvent(eventId);
        processing = result.reason ? { status: result.status, reason: result.reason } : { status: result.status };
      } catch (err) {
        logger.error('Webhook processing error (non-fatal)', { eventId, error: err instanceof Error ? err.message : err });
        processing = { status: 'pending', reason: 'processing error' };
      }
    }

    res.status(200).json({
      status: 'received',
      duplicate: isDuplicate,
      event_id: eventId,
      system: system.code,
      ...(processing ? { processing } : {}),
    });
  } catch (err) {
    logger.error('Webhook receive error', { error: err instanceof Error ? err.message : err });
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

export default router;

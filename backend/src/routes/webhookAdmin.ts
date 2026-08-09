/**
 * Fase D3.1 — Rotas admin para webhooks de saída.
 *
 * Endpoints:
 *   GET    /api/admin/outbound-webhooks      — listar
 *   POST   /api/admin/outbound-webhooks      — criar
 *   GET    /api/admin/outbound-webhooks/:id   — obter
 *   PUT    /api/admin/outbound-webhooks/:id   — atualizar
 *   DELETE /api/admin/outbound-webhooks/:id   — remover
 *   POST   /api/admin/outbound-webhooks/:id/test — enviar evento de teste
 *   GET    /api/admin/outbound-webhooks/deliveries — histórico de entregas
 */

import { Router, type Request, type Response } from 'express';
import { all, get, run } from '../database.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { hashSecret, isValidWebhookUrl, retryDelivery } from '../lib/webhookDispatcher.js';
import { parsePagination, buildPaginationMeta } from '../lib/pagination.js';
import { logger } from '../lib/logger.js';
import { logAudit } from '../lib/audit.js';

const router = Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function jsonOk(res: Response, data: unknown, status = 200) {
  return res.status(status).json(data);
}

function jsonErr(res: Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

/* ------------------------------------------------------------------ */
/* Middleware de autenticação + permissão admin                         */
/* ------------------------------------------------------------------ */

router.use(authenticateToken);
router.use(requirePermission('integrations.admin'));

/* ------------------------------------------------------------------ */
/* GET / — listar webhooks de saída                                     */
/* ------------------------------------------------------------------ */

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await all<{
      id: number;
      name: string;
      url: string;
      events: string[];
      active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, url, events, active, created_at, updated_at
       FROM outbound_webhooks
       ORDER BY created_at DESC`
    );

    return jsonOk(res, { webhooks: rows });
  } catch (err) {
    logger.error('outbound-webhooks.list error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* GET /deliveries — histórico de entregas (ANTES de /:id)             */
/* ------------------------------------------------------------------ */

router.get('/deliveries', async (req: Request, res: Response) => {
  try {
    const { webhook_id, status } = req.query as {
      webhook_id?: string;
      status?: string;
    };

    const { page, limit, offset } = parsePagination(req.query, { limit: 50 });
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (webhook_id) {
      conditions.push(`d.webhook_id = $${params.length + 1}`);
      params.push(webhook_id);
    }
    if (status) {
      conditions.push(`d.status = $${params.length + 1}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await get<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM webhook_deliveries d ${where}`,
      params
    );
    const total = parseInt(countRow?.total ?? '0', 10);

    params.push(limit, offset);

    const rows = await all<{
      id: number;
      webhook_id: number;
      webhook_name: string;
      event_type: string;
      url: string;
      response_status: number | null;
      duration_ms: number | null;
      attempt: number;
      status: string;
      error: string | null;
      created_at: string;
    }>(
      `SELECT d.id, d.webhook_id, w.name AS webhook_name, d.event_type, d.url,
              d.response_status, d.duration_ms, d.attempt, d.status, d.error, d.created_at
       FROM webhook_deliveries d
       JOIN outbound_webhooks w ON w.id = d.webhook_id
       ${where}
       ORDER BY d.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return jsonOk(res, {
      deliveries: rows,
      pagination: buildPaginationMeta(total, { page, limit, offset }),
    });
  } catch (err) {
    logger.error('outbound-webhooks.deliveries error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* GET /stats — dashboard de webhooks (ANTES de /:id)                  */
/* ------------------------------------------------------------------ */

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [totalRow, activeRow, last24hRow, deadLetterRow, failedByWebhook] = await Promise.all([
      get<{ count: string }>('SELECT COUNT(*)::text AS count FROM outbound_webhooks'),
      get<{ count: string }>('SELECT COUNT(*)::text AS count FROM outbound_webhooks WHERE active = TRUE'),
      get<{ total: string; success: string; failed: string; dead_letter: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE status = 'success')::text AS success,
           COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
           COUNT(*) FILTER (WHERE status = 'dead_letter')::text AS dead_letter
         FROM webhook_deliveries
         WHERE created_at >= NOW() - INTERVAL '24 hours'`
      ),
      get<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM webhook_deliveries WHERE status = 'dead_letter'`
      ),
      all<{
        webhook_id: number;
        webhook_name: string;
        dead_letter_count: string;
        last_failed_at: string | null;
      }>(
        `SELECT d.webhook_id, w.name AS webhook_name,
                COUNT(*)::text AS dead_letter_count,
                MAX(d.created_at)::text AS last_failed_at
         FROM webhook_deliveries d
         JOIN outbound_webhooks w ON w.id = d.webhook_id
         WHERE d.status = 'dead_letter'
         GROUP BY d.webhook_id, w.name
         ORDER BY COUNT(*) DESC
         LIMIT 10`
      ),
    ]);

    const last24h = last24hRow
      ? {
          total: parseInt(last24hRow.total, 10) || 0,
          success: parseInt(last24hRow.success, 10) || 0,
          failed: parseInt(last24hRow.failed, 10) || 0,
          dead_letter: parseInt(last24hRow.dead_letter, 10) || 0,
        }
      : { total: 0, success: 0, failed: 0, dead_letter: 0 };

    return jsonOk(res, {
      totalWebhooks: parseInt(totalRow?.count ?? '0', 10),
      activeWebhooks: parseInt(activeRow?.count ?? '0', 10),
      last24h,
      totalDeadLetter: parseInt(deadLetterRow?.count ?? '0', 10),
      topDeadLetterWebhooks: failedByWebhook.map((r) => ({
        webhookId: r.webhook_id,
        webhookName: r.webhook_name,
        deadLetterCount: parseInt(r.dead_letter_count, 10),
        lastFailedAt: r.last_failed_at,
      })),
    });
  } catch (err) {
    logger.error('outbound-webhooks.stats error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* POST / — criar webhook de saída                                     */
/* ------------------------------------------------------------------ */

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, url, secret, events } = req.body as {
      name?: string;
      url?: string;
      secret?: string;
      events?: string[];
    };

    if (!name || !url || !secret || !events?.length) {
      return jsonErr(res, 'Campos obrigatórios: name, url, secret, events[]');
    }

    if (secret.length < 16) {
      return jsonErr(res, 'Segredo deve ter pelo menos 16 caracteres');
    }

    // Validação anti-SSRF
    const urlCheck = isValidWebhookUrl(url);
    if (!urlCheck.valid) {
      return jsonErr(res, `URL inválida: ${urlCheck.error}`);
    }

    // Valida eventos conhecidos
    const validEvents = [
      'demand:created', 'demand:updated', 'demand:status_changed', 'demand.deleted',
      'comment.created',
    ];
    const invalidEvents = events.filter((e) => !validEvents.includes(e));
    if (invalidEvents.length > 0) {
      return jsonErr(res, `Eventos inválidos: ${invalidEvents.join(', ')}`);
    }

    const secretHash = hashSecret(secret);

    const result = await run(
      `INSERT INTO outbound_webhooks (name, url, secret_hash, events, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, url, events, active, created_at, updated_at`,
      [name, url, secretHash, events, req.user?.id ?? undefined]
    );

    const webhook = result.rows[0];

    await logAudit({
      action: 'create',
      entity_type: 'outbound_webhook',
      entity_id: String(webhook.id),
      user_id: req.user?.id ?? undefined,
      details: { name, url, events },
    });

    logger.info('outbound-webhook created', { id: webhook.id, name, events });
    return jsonOk(res, webhook, 201);
  } catch (err) {
    logger.error('outbound-webhooks.create error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* GET /:id — obter webhook de saída                                   */
/* ------------------------------------------------------------------ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const webhook = await get<{ id: number; name: string; url: string; events: string[]; active: boolean }>(
      `SELECT id, name, url, events, active, created_at, updated_at
       FROM outbound_webhooks WHERE id = $1`,
      [id]
    );

    if (!webhook) {
      return jsonErr(res, 'Webhook não encontrado', 404);
    }

    return jsonOk(res, webhook);
  } catch (err) {
    logger.error('outbound-webhooks.get error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* PUT /:id — atualizar webhook de saída                               */
/* ------------------------------------------------------------------ */

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, url, secret, events, active } = req.body as {
      name?: string;
      url?: string;
      secret?: string;
      events?: string[];
      active?: boolean;
    };

    const existing = await get<{ id: number }>(
      `SELECT id FROM outbound_webhooks WHERE id = $1`, [id]
    );
    if (!existing) {
      return jsonErr(res, 'Webhook não encontrado', 404);
    }

    // Validação anti-SSRF se URL fornecida
    if (url) {
      const urlCheck = isValidWebhookUrl(url);
      if (!urlCheck.valid) {
        return jsonErr(res, `URL inválida: ${urlCheck.error}`);
      }
    }

    // Valida eventos se fornecidos
    if (events) {
      const validEvents = [
        'demand:created', 'demand:updated', 'demand:status_changed', 'demand.deleted',
        'comment.created',
      ];
      const invalidEvents = events.filter((e) => !validEvents.includes(e));
      if (invalidEvents.length > 0) {
        return jsonErr(res, `Eventos inválidos: ${invalidEvents.join(', ')}`);
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
    if (url !== undefined) { updates.push(`url = $${idx++}`); params.push(url); }
    if (secret !== undefined) {
      if (secret.length < 16) return jsonErr(res, 'Segredo deve ter pelo menos 16 caracteres');
      updates.push(`secret_hash = $${idx++}`);
      params.push(hashSecret(secret));
    }
    if (events !== undefined) { updates.push(`events = $${idx++}`); params.push(events); }
    if (active !== undefined) { updates.push(`active = $${idx++}`); params.push(active); }

    if (updates.length === 0) {
      return jsonErr(res, 'Nenhum campo para atualizar');
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await run(
      `UPDATE outbound_webhooks SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, name, url, events, active, created_at, updated_at`,
      params
    );

    await logAudit({
      action: 'update',
      entity_type: 'outbound_webhook',
      entity_id: String(id),
      user_id: req.user?.id ?? undefined,
      details: { name, url, events, active },
    });

    return jsonOk(res, result.rows[0]);
  } catch (err) {
    logger.error('outbound-webhooks.update error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* DELETE /:id — remover webhook de saída                              */
/* ------------------------------------------------------------------ */

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await get<{ id: number }>(
      `SELECT id FROM outbound_webhooks WHERE id = $1`, [id]
    );
    if (!existing) {
      return jsonErr(res, 'Webhook não encontrado', 404);
    }

    await run(`DELETE FROM outbound_webhooks WHERE id = $1`, [id]);

    await logAudit({
      action: 'delete',
      entity_type: 'outbound_webhook',
      entity_id: String(id),
      user_id: req.user?.id ?? undefined,
      details: {},
    });

    return jsonOk(res, { deleted: true });
  } catch (err) {
    logger.error('outbound-webhooks.delete error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* POST /:id/test — enviar evento de teste                             */
/* ------------------------------------------------------------------ */

router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const webhook = await get<{ id: number; name: string; url: string; events: string[]; active: boolean }>(
      `SELECT id, name, url, events, active FROM outbound_webhooks WHERE id = $1`,
      [id]
    );

    if (!webhook) {
      return jsonErr(res, 'Webhook não encontrado', 404);
    }

    if (!webhook.active) {
      return jsonErr(res, 'Webhook inativo — ative antes de testar');
    }

    // Importa e usa o dispatcher para enviar evento de teste
    const { signPayload } = await import('../lib/webhookDispatcher.js');
    const crypto = await import('crypto');

    const testPayload = {
      id: crypto.randomUUID(),
      type: 'webhook:test',
      timestamp: new Date().toISOString(),
      data: { message: 'Evento de teste do SGD', webhookId: webhook.id },
    };

    const body = JSON.stringify(testPayload);
    const secretEnvKey = `OUTBOUND_WEBHOOK_SECRET_${webhook.id}`;
    const secret = process.env[secretEnvKey];

    if (!secret || secret.length < 16) {
      return jsonErr(res, `Segredo não configurado: defina a variável ${secretEnvKey}`);
    }

    const signature = signPayload(secret, body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-SGD-Signature': signature,
      'X-SGD-Event': 'webhook:test',
      'X-SGD-Delivery': testPayload.id,
      'User-Agent': 'SGD-Webhook/2.0',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let status: number;
    let responseBody: string;
    let durationMs: number;

    try {
      const start = Date.now();
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      status = response.status;
      responseBody = (await response.text()).slice(0, 5000);
      durationMs = Date.now() - start;
    } catch (err) {
      clearTimeout(timeout);
      return jsonErr(res, `Falha na entrega: ${err instanceof Error ? err.message : String(err)}`);
    }

    const ok = status >= 200 && status < 300;

    await logAudit({
      action: 'test',
      entity_type: 'outbound_webhook',
      entity_id: String(webhook.id),
      user_id: req.user?.id ?? undefined,
      details: { status, ok, durationMs },
    });

    return jsonOk(res, {
      ok,
      status,
      durationMs,
      body: responseBody,
    });
  } catch (err) {
    logger.error('outbound-webhooks.test error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* POST /deliveries/:id/retry — reenvio manual                         */
/* ------------------------------------------------------------------ */

router.post('/deliveries/:id/retry', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const deliveryId = parseInt(id, 10);
    if (isNaN(deliveryId)) {
      return jsonErr(res, 'ID inválido');
    }

    const result = await retryDelivery(deliveryId);
    if (!result) {
      return jsonErr(res, 'Entrega não encontrada ou não reenviável (status deve ser failed ou dead_letter)', 404);
    }

    await logAudit({
      action: 'retry',
      entity_type: 'webhook_delivery',
      entity_id: String(deliveryId),
      user_id: req.user?.id ?? undefined,
      details: { newDeliveryId: result.id, status: result.status, attempt: result.attempt },
    });

    logger.info('webhook delivery retried', { originalId: deliveryId, newId: result.id, status: result.status });
    return jsonOk(res, result);
  } catch (err) {
    logger.error('outbound-webhooks.retry error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

/* ------------------------------------------------------------------ */
/* GET /deliveries/:id — detalhes de uma entrega                       */
/* ------------------------------------------------------------------ */

router.get('/deliveries/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const delivery = await get<{
      id: number;
      webhook_id: number;
      webhook_name: string;
      event_type: string;
      url: string;
      request_headers: Record<string, string> | null;
      request_body: unknown;
      response_status: number | null;
      response_body: string | null;
      duration_ms: number | null;
      attempt: number;
      max_attempts: number;
      status: string;
      error: string | null;
      delivery_id: string | null;
      created_at: string;
      updated_at: string;
      resolved_at: string | null;
    }>(
      `SELECT d.*, w.name AS webhook_name
       FROM webhook_deliveries d
       JOIN outbound_webhooks w ON w.id = d.webhook_id
       WHERE d.id = $1`,
      [id]
    );

    if (!delivery) {
      return jsonErr(res, 'Entrega não encontrada', 404);
    }

    return jsonOk(res, delivery);
  } catch (err) {
    logger.error('outbound-webhooks.delivery.get error', { error: String(err) });
    return jsonErr(res, 'Erro interno', 500);
  }
});

export default router;

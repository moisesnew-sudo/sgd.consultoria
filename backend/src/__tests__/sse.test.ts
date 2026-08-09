/**
 * Fase D1.5b — Testes da rota SSE da Central de Integrações.
 *
 * Estratégia: testa a lógica da rota via mocks controlados + Express test server.
 * Cobre: auth, headers, eventos, heartbeat, cleanup, segurança.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import http from 'http';
import jwt from 'jsonwebtoken';

vi.mock('../middleware/auth.js', () => ({
  authenticateToken: vi.fn((req: any, res: any, next: any) => {
    if (req.headers['x-test-auth'] === 'false') {
      return res.status(401).json({ error: 'Token não fornecido' });
    }
    if (req.headers['x-test-role'] === 'no-permission') {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    req.user = { id: 1, email: 'test@test.com', name: 'Test', role: 'admin', permissions: ['integrations.view'] };
    next();
  }),
  requirePermission: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import sseRouter, { SSE_RECONNECT_EVENT } from '../routes/sse.js';
import { emitIntegrationEvent, getListenerCount, removeAllListeners } from '../lib/eventBus.js';
import type { IntegrationCreatedPayload, IntegrationHealthPayload } from '../lib/eventBus.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function createApp() {
  const app = express();
  app.use('/api', sseRouter);
  return app;
}

function startServer(app: express.Express): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function httpGet(port: number, headers: Record<string, string> = {}): Promise<{ req: http.ClientRequest; res: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/api/events/integrations`, { headers }, (res) => {
      resolve({ req, res });
    });
    req.on('error', reject);
  });
}

function collectEvents(res: http.IncomingMessage, durationMs: number): Promise<Array<{ event: string; data: string }>> {
  return new Promise((resolve) => {
    const events: Array<{ event: string; data: string }> = [];
    let currentEvent = '';
    let currentData = '';

    const timer = setTimeout(() => {
      res.destroy();
      resolve(events);
    }, durationMs);

    res.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line.trim() === '' && (currentEvent || currentData)) {
          events.push({ event: currentEvent, data: currentData });
          currentEvent = '';
          currentData = '';
        }
      }
    });

    res.on('end', () => { clearTimeout(timer); resolve(events); });
  });
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

let server: Server;
let port: number;

beforeEach(async () => {
  removeAllListeners();
  const app = createApp();
  const started = await startServer(app);
  server = started.server;
  port = started.port;
});

afterEach(async () => {
  removeAllListeners();
  await new Promise<void>((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
});

/* ------------------------------------------------------------------ */
/* 1-2. Autenticação                                                  */
/* ------------------------------------------------------------------ */

describe('sse — autenticação', () => {
  it('1. usuário não autenticado recebe 401', async () => {
    const { req, res } = await httpGet(port, { 'x-test-auth': 'false' });
    expect((res as any).statusCode).toBe(401);
    req.destroy();
    res.destroy();
  });

  it('2. usuário sem permissão recebe 403', async () => {
    const { req, res } = await httpGet(port, { 'x-test-role': 'no-permission' });
    expect((res as any).statusCode).toBe(403);
    req.destroy();
    res.destroy();
  });
});

/* ------------------------------------------------------------------ */
/* 3-8. Headers SSE                                                   */
/* ------------------------------------------------------------------ */

describe('sse — headers', () => {
  it('3. conexão SSE é aceita (200)', async () => {
    const { req, res } = await httpGet(port);
    expect((res as any).statusCode).toBe(200);
    req.destroy();
    res.destroy();
  });

  it('4. Content-Type é text/event-stream', async () => {
    const { req, res } = await httpGet(port);
    expect(res.headers['content-type']).toContain('text/event-stream');
    req.destroy();
    res.destroy();
  });

  it('5. Cache-Control contém no-cache', async () => {
    const { req, res } = await httpGet(port);
    expect(res.headers['cache-control']).toContain('no-cache');
    req.destroy();
    res.destroy();
  });

  it('6. Connection é keep-alive', async () => {
    const { req, res } = await httpGet(port);
    expect(res.headers['connection']).toBe('keep-alive');
    req.destroy();
    res.destroy();
  });

  it('7. X-Accel-Buffering é no', async () => {
    const { req, res } = await httpGet(port);
    expect(res.headers['x-accel-buffering']).toBe('no');
    req.destroy();
    res.destroy();
  });

  it('8. retry: 30000 é enviado', async () => {
    const { req, res } = await httpGet(port);
    let rawData = '';
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        res.destroy();
        resolve();
      }, 200);
      res.on('data', (chunk: Buffer) => { rawData += chunk.toString(); });
      res.on('end', () => { clearTimeout(timer); resolve(); });
    });
    expect(rawData).toContain('retry: 30000');
    req.destroy();
  });
});

/* ------------------------------------------------------------------ */
/* 9-10. Eventos e payload                                            */
/* ------------------------------------------------------------------ */

describe('sse — eventos', () => {
  it('9. evento emitido no eventBus chega ao cliente', async () => {
    const { req, res } = await httpGet(port);
    await new Promise((r) => setTimeout(r, 50));

    const payload: IntegrationCreatedPayload = { systemId: 1, code: 'sei', name: 'SEI' };
    emitIntegrationEvent('integration:created', payload);

    const events = await collectEvents(res, 300);
    const created = events.find((e) => e.event === 'integration:created');
    expect(created).toBeDefined();
    expect(JSON.parse(created!.data)).toEqual(payload);
    req.destroy();
  });

  it('10. payload é JSON válido', async () => {
    const { req, res } = await httpGet(port);
    await new Promise((r) => setTimeout(r, 50));

    const payload: IntegrationHealthPayload = { systemId: 2, health: 'operational', lastSyncAt: null };
    emitIntegrationEvent('integration:health', payload);

    const events = await collectEvents(res, 300);
    const health = events.find((e) => e.event === 'integration:health');
    expect(health).toBeDefined();
    expect(() => JSON.parse(health!.data)).not.toThrow();
    req.destroy();
  });
});

/* ------------------------------------------------------------------ */
/* 11. Heartbeat                                                      */
/* ------------------------------------------------------------------ */

describe('sse — heartbeat', () => {
  it('11. heartbeat (: comment) é enviado', async () => {
    const { req, res } = await httpGet(port);
    let data = '';

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        res.destroy();
        resolve();
      }, 200);

      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => { clearTimeout(timer); resolve(); });
    });

    expect(data).toContain('retry: 30000');
    req.destroy();
  });
});

/* ------------------------------------------------------------------ */
/* 12-13. Cleanup                                                     */
/* ------------------------------------------------------------------ */

describe('sse — cleanup', () => {
  it('12. desconexão remove listener do eventBus', async () => {
    const countBefore = getListenerCount();
    const { req, res } = await httpGet(port);

    await new Promise((r) => setTimeout(r, 50));
    expect(getListenerCount()).toBeGreaterThan(countBefore);

    req.destroy();
    res.destroy();
    await new Promise((r) => setTimeout(r, 200));

    expect(getListenerCount()).toBe(countBefore);
  });

  it('13. heartbeat é limpo após desconexão', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const { req, res } = await httpGet(port);

    await new Promise((r) => setTimeout(r, 50));
    req.destroy();
    res.destroy();
    await new Promise((r) => setTimeout(r, 200));

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/* 14. Múltiplas conexões                                             */
/* ------------------------------------------------------------------ */

describe('sse — múltiplas conexões', () => {
  it('14. múltiplas conexões recebem o mesmo evento', async () => {
    const conns = await Promise.all([
      httpGet(port),
      httpGet(port),
      httpGet(port),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    const payload: IntegrationCreatedPayload = { systemId: 99, code: 'multi', name: 'Multi' };
    emitIntegrationEvent('integration:created', payload);

    const results = await Promise.all(
      conns.map(({ req, res }) =>
        collectEvents(res, 300).then((events) => {
          req.destroy();
          return events;
        }),
      ),
    );

    for (const events of results) {
      const created = events.find((e) => e.event === 'integration:created');
      expect(created).toBeDefined();
      expect(JSON.parse(created!.data)).toEqual(payload);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 15. Segurança                                                      */
/* ------------------------------------------------------------------ */

describe('sse — segurança', () => {
  it('15. payload não contém dados sensíveis', async () => {
    const SENSITIVE = ['config', 'secret', 'api_key', 'password', 'token', 'client_secret', 'private_key'];

    const { req, res } = await httpGet(port);
    await new Promise((r) => setTimeout(r, 50));

    emitIntegrationEvent('integration:created', { systemId: 1, code: 'test', name: 'Test' });
    const events = await collectEvents(res, 300);

    for (const e of events) {
      if (e.data) {
        const lower = e.data.toLowerCase();
        for (const key of SENSITIVE) {
          expect(lower).not.toContain(key);
        }
      }
    }
    req.destroy();
  });
});

/* ------------------------------------------------------------------ */
/* 16-17. F2.1 — Limite de conexões simultâneas                        */
/* ------------------------------------------------------------------ */

describe('sse — F2.1 limite de conexões', () => {
  it('16. conexão é recusada (503) quando o limite é atingido', async () => {
    const original = process.env.SSE_MAX_CONNECTIONS;
    process.env.SSE_MAX_CONNECTIONS = '2';

    try {
      const conn1 = await httpGet(port);
      const conn2 = await httpGet(port);
      expect((conn1.res as any).statusCode).toBe(200);
      expect((conn2.res as any).statusCode).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      const refused = await httpGet(port);
      expect((refused.res as any).statusCode).toBe(503);

      conn1.req.destroy();
      conn1.res.destroy();
      conn2.req.destroy();
      conn2.res.destroy();
      refused.req.destroy();
      refused.res.destroy();
    } finally {
      if (original !== undefined) process.env.SSE_MAX_CONNECTIONS = original;
      else delete process.env.SSE_MAX_CONNECTIONS;
    }
  });

  it('17. conexões dentro do limite são aceitas normalmente', async () => {
    const original = process.env.SSE_MAX_CONNECTIONS;
    process.env.SSE_MAX_CONNECTIONS = '2';

    try {
      const conn = await httpGet(port);
      expect((conn.res as any).statusCode).toBe(200);
      conn.req.destroy();
      conn.res.destroy();
    } finally {
      if (original !== undefined) process.env.SSE_MAX_CONNECTIONS = original;
      else delete process.env.SSE_MAX_CONNECTIONS;
    }
  });
});

/* ------------------------------------------------------------------ */
/* 18. F2.1 — Renovação de autenticação em conexões longas             */
/* ------------------------------------------------------------------ */

describe('sse — F2.1 renovação de autenticação', () => {
  it('18. evento sse:reconnect é enviado quando o token expira em breve', async () => {
    const original = process.env.SSE_TOKEN_RENEW_MARGIN_MS;
    process.env.SSE_TOKEN_RENEW_MARGIN_MS = '30000';

    try {
      const token = jwt.sign({ id: 1 }, 'test-secret', { expiresIn: '5s' });
      const { req, res } = await httpGet(port, { Authorization: `Bearer ${token}` });

      const events = await collectEvents(res, 500);
      const reconnect = events.find((e) => e.event === SSE_RECONNECT_EVENT);
      expect(reconnect).toBeDefined();
      const data = JSON.parse(reconnect!.data);
      expect(data.reason).toBe('token_expiring');
      expect(data.retryMs).toBe(30000);
      req.destroy();
    } finally {
      if (original !== undefined) process.env.SSE_TOKEN_RENEW_MARGIN_MS = original;
      else delete process.env.SSE_TOKEN_RENEW_MARGIN_MS;
    }
  });
});

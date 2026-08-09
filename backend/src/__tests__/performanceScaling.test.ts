/**
 * Fase F2.2 — Testes de Performance, Escalabilidade e Alta Disponibilidade.
 *
 * Cobertura:
 * 1. Rate limit institucional: key generator (anônimo/usuário/admin/JWT)
 * 2. Rate limit institucional: headers X-RateLimit-* e 429 com Retry-After
 * 3. Rate limit institucional: bloqueio registrado no healthStatus
 * 4. Cache: hit/miss, invalidação por prefixo
 * 5. Cache: invalidação por evento (eventBus)
 * 6. Job queue: enqueue + processamento bem-sucedido
 * 7. Job queue: retry com backoff (retrying → failed)
 * 8. Job queue: job sem handler → failed
 * 9. Job queue: auditoria gravada (audit_logs)
 * 10. Health: métricas de API, rate limit e job queue integradas
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { run, get } from '../database.js';
import {
  institutionalKeyGenerator,
  createInstitutionalRateLimit,
  rateLimitHeaders,
} from '../middleware/rateLimit.js';
import {
  setCache,
  getCached,
  resetCacheMetrics,
  invalidateCacheByPrefix,
  registerCacheInvalidation,
} from '../lib/cache.js';
import {
  enqueueJob,
  registerJobHandler,
  processDueJobs,
} from '../lib/jobQueue.js';
import {
  recordApiRequest,
  recordRateLimitBlock,
  resetApiMetrics,
  resetRateLimitMetrics,
  resetJobQueueMetrics,
  getAPIStatus,
  getRateLimitStatus,
  getJobQueueStatus,
  getHealthReport,
} from '../lib/healthStatus.js';
import { publishEvent } from '../lib/eventBus.js';

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

const createdJobIds: number[] = [];

afterEach(async () => {
  resetCacheMetrics();
  resetApiMetrics();
  resetRateLimitMetrics();
  resetJobQueueMetrics();

  if (createdJobIds.length > 0) {
    await run(`DELETE FROM background_jobs WHERE id = ANY($1::int[])`, [createdJobIds]);
    createdJobIds.length = 0;
  }
  await run(`DELETE FROM audit_logs WHERE entity_type = 'background_job'`);
});

/* ------------------------------------------------------------------ */
/* 1–3: Rate limit institucional                                       */
/* ------------------------------------------------------------------ */

describe('rateLimit institucional', () => {
  it('1. key generator: anônimo por IP, usuário por id, admin por id, via JWT', () => {
    const anonReq = { ip: '10.0.0.1', socket: {} } as any;
    expect(institutionalKeyGenerator(anonReq)).toBe('ip:10.0.0.1');

    const userReq = { ip: '10.0.0.1', user: { id: 7, role: 'gestor' } } as any;
    expect(institutionalKeyGenerator(userReq)).toBe('user:7');

    const adminReq = { ip: '10.0.0.1', user: { id: 1, role: 'admin' } } as any;
    expect(institutionalKeyGenerator(adminReq)).toBe('admin:1');

    // Sem req.user, mas com JWT no cookie — usado quando o limiter roda antes do auth
    const token = jwt.sign({ id: 42, role: 'analista' }, 'test-secret');
    const cookieReq = { ip: '10.0.0.1', cookies: { token } } as any;
    expect(institutionalKeyGenerator(cookieReq)).toBe('user:42');

    // Token inválido → anônimo
    const badReq = { ip: '10.0.0.1', headers: { authorization: 'Bearer not.a.token' } } as any;
    expect(institutionalKeyGenerator(badReq)).toBe('ip:10.0.0.1');

    // admin via JWT (sem req.user)
    const adminToken = jwt.sign({ id: 9, role: 'admin' }, 'test-secret');
    const adminCookieReq = { ip: '10.0.0.1', cookies: { token: adminToken } } as any;
    expect(institutionalKeyGenerator(adminCookieReq)).toBe('admin:9');
  });

  it('2. limiter emite 429 com headers X-RateLimit-* e Retry-After ao exceder limite anônimo', async () => {
    resetRateLimitMetrics();
    const app = express();
    app.use(cookieParser());
    app.use('/api/', createInstitutionalRateLimit({
      windowMs: 60_000,
      anonymousMax: 3,
      authenticatedMax: 100,
      adminMax: 1000,
    }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/api/test');
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    }

    const blocked = await request(app).get('/api/test');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.error).toBeDefined();
  });

  it('3. bloqueios são registrados no healthStatus', async () => {
    resetRateLimitMetrics();
    expect(getRateLimitStatus().blockedRequests).toBe(0);

    const app = express();
    app.use('/api/', createInstitutionalRateLimit({
      windowMs: 60_000,
      anonymousMax: 1,
      authenticatedMax: 100,
      adminMax: 1000,
    }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    await request(app).get('/api/test');
    expect(getRateLimitStatus().blockedRequests).toBe(0);

    await request(app).get('/api/test');
    expect(getRateLimitStatus().blockedRequests).toBe(1);
    expect(getRateLimitStatus().lastBlockedAt).not.toBeNull();
  });

  it('3b. rateLimitHeaders injeta headers sem bloquear', async () => {
    const app = express();
    app.get('/api/x', rateLimitHeaders, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/api/x');
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* 4–5: Cache                                                          */
/* ------------------------------------------------------------------ */

describe('cache operacional', () => {
  it('4. hit/miss e invalidação por prefixo', () => {
    resetCacheMetrics();
    setCache('dashboard-stats:2026', { total: 10 });
    expect(getCached('dashboard-stats:2026')).toEqual({ total: 10 });
    expect(getCached('nao-existe')).toBeUndefined();

    const before = getCached('dashboard-stats:2026');
    expect(before).toBeDefined();

    expect(invalidateCacheByPrefix('dashboard-stats')).toBe(1);
    expect(getCached('dashboard-stats:2026')).toBeUndefined();
  });

  it('5. invalidação por evento (demand:updated limpa dashboards)', async () => {
    resetCacheMetrics();
    setCache('dashboard-stats:2026', { total: 1 });
    setCache('executive-stats:2026', { total: 2 });
    setCache('integrations:list', { n: 3 });
    expect(getCached('dashboard-stats:2026')).toBeDefined();

    registerCacheInvalidation();
    // Aguarda o listener dinâmico ser registrado
    await new Promise((r) => setTimeout(r, 50));

    publishEvent('demand:updated', {
      demandId: 'DEM-1',
      title: 'TESTE',
      changes: ['status'],
    });

    expect(getCached('dashboard-stats:2026')).toBeUndefined();
    expect(getCached('executive-stats:2026')).toBeUndefined();
    // Integrações não são invalidados por demand:updated
    expect(getCached('integrations:list')).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* 6–9: Job queue                                                      */
/* ------------------------------------------------------------------ */

describe('job queue (PostgreSQL)', () => {
  it('6. enqueue + processamento bem-sucedido', async () => {
    resetJobQueueMetrics();
    registerJobHandler('perf:ok', async (payload) => {
      expect(payload.input).toBe(42);
    });

    const id = await enqueueJob({ type: 'perf:ok', payload: { input: 42 }, maxAttempts: 2 });
    createdJobIds.push(id);

    const processed = await processDueJobs(10);
    expect(processed).toBeGreaterThanOrEqual(1);

    const job = await get<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM background_jobs WHERE id = $1`, [id]
    );
    expect(job!.status).toBe('succeeded');
    expect(job!.attempts).toBe(1);
    expect(getJobQueueStatus().succeeded).toBeGreaterThanOrEqual(1);
  });

  it('7. falha com retry → retrying, depois failed após esgotar tentativas', async () => {
    resetJobQueueMetrics();
    let calls = 0;
    registerJobHandler('perf:flaky', async () => {
      calls++;
      throw new Error('falha controlada');
    });

    const id = await enqueueJob({ type: 'perf:flaky', maxAttempts: 2 });
    createdJobIds.push(id);

    // 1ª execução → retrying (attempts=1 < 2)
    await processDueJobs(10);
    let job = await get<{ status: string; attempts: number; last_error: string }>(
      `SELECT status, attempts, last_error FROM background_jobs WHERE id = $1`, [id]
    );
    expect(job!.status).toBe('retrying');
    expect(job!.attempts).toBe(1);
    expect(job!.last_error).toContain('falha controlada');

    // Força a janela de backoff a vencer (simula o tempo transcorrido)
    await run(`UPDATE background_jobs SET next_run_at = NOW() - interval '1 second' WHERE id = $1`, [id]);

    // 2ª execução → failed (attempts=2 >= 2)
    await processDueJobs(10);
    const finishedJob = await get<{ status: string; attempts: number; finished_at: string }>(
      `SELECT status, attempts, finished_at FROM background_jobs WHERE id = $1`, [id]
    );
    expect(finishedJob!.status).toBe('failed');
    expect(finishedJob!.attempts).toBe(2);
    expect(finishedJob!.finished_at).not.toBeNull();
    expect(calls).toBe(2);
    expect(getJobQueueStatus().failed).toBeGreaterThanOrEqual(1);
  });

  it('8. job sem handler registrado → failed com erro descritivo', async () => {
    const id = await enqueueJob({ type: 'perf:inexistente', maxAttempts: 1 });
    createdJobIds.push(id);

    await processDueJobs(10);

    const job = await get<{ status: string; last_error: string }>(
      `SELECT status, last_error FROM background_jobs WHERE id = $1`, [id]
    );
    expect(job!.status).toBe('failed');
    expect(job!.last_error).toContain('Nenhum handler');
  });

  it('9. auditoria dos jobs gravada em audit_logs', async () => {
    registerJobHandler('perf:audit', async () => {});

    const id = await enqueueJob({ type: 'perf:audit', maxAttempts: 1, createdBy: 1 });
    createdJobIds.push(id);

    await processDueJobs(10);

    const actions = await get<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE entity_type = 'background_job' AND entity_id = $1
       ORDER BY created_at DESC LIMIT 1`, [String(id)]
    );
    expect(actions!.action).toBe('job:succeeded');
  });
});

/* ------------------------------------------------------------------ */
/* 10: Health integration                                              */
/* ------------------------------------------------------------------ */

describe('healthStatus integração F2.2', () => {
  it('10. métricas de API, rate limit e job queue compõem o report', () => {
    resetApiMetrics();
    resetRateLimitMetrics();
    resetJobQueueMetrics();

    recordApiRequest(200, 30);
    recordApiRequest(404, 40);
    recordApiRequest(500, 600);
    recordRateLimitBlock();

    const api = getAPIStatus();
    expect(api.totalRequests).toBe(3);
    expect(api.errors4xx).toBe(1);
    expect(api.errors5xx).toBe(1);
    expect(api.slowRequests).toBe(1);
    expect(api.averageResponseTime).toBeGreaterThan(0);

    expect(getRateLimitStatus().blockedRequests).toBe(1);

    const report = getHealthReport();
    expect(report.api.totalRequests).toBe(3);
    expect(report.rateLimit.blockedRequests).toBe(1);
    expect(report.jobQueue).toBeDefined();
    expect(report.cache).toBeDefined();
  });
});

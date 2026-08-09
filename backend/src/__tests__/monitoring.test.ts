import { describe, it, expect } from 'vitest';
import { loginAs, admin, gestor } from './helpers.js';

describe('Monitoring', () => {
  it('deve retornar health check', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/monitoring/health');
    expect(res.status).toBe(200);
    expect(res.body.server).toBeDefined();
    expect(res.body.database).toBeDefined();
    expect(res.body.api).toBeDefined();
  });
});

/**
 * D2.3 — Dashboard Operacional de Saúde.
 * Testes do endpoint GET /api/monitoring/system-health.
 */
describe('System Health Dashboard (D2.3)', () => {
  it('1. endpoint retorna 200 para admin autenticado', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/monitoring/system-health');
    expect(res.status).toBe(200);
  });

  it('2. retorna 401 sem autenticação', async () => {
    const res = await (await import('supertest')).default((await import('../server.js')).default)
      .get('/api/monitoring/system-health');
    expect(res.status).toBe(401);
  });

  it('3. retorna 403 para usuário não-admin (gestor)', async () => {
    const agent = await loginAs(gestor.email, gestor.password);
    const res = await agent.get('/api/monitoring/system-health');
    expect(res.status).toBe(403);
  });

  it('4. retorna componentes de saúde (database, listener, eventBus, sse, scheduler)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/monitoring/system-health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBeDefined();
    expect(res.body.database.status).toBeDefined();
    expect(typeof res.body.database.totalConnections).toBe('number');
    expect(res.body.postgresListener).toBeDefined();
    expect(typeof res.body.postgresListener.connected).toBe('boolean');
    expect(res.body.eventBus).toBeDefined();
    expect(typeof res.body.eventBus.eventsPublished).toBe('number');
    expect(res.body.sse).toBeDefined();
    expect(typeof res.body.sse.activeConnections).toBe('number');
    expect(res.body.scheduler).toBeDefined();
    expect(typeof res.body.scheduler.active).toBe('boolean');
  });

  it('5. retorna alertas ativos', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/monitoring/system-health');
    expect(res.status).toBe(200);
    expect(res.body.alerts).toBeDefined();
    expect(Array.isArray(res.body.alerts.items)).toBe(true);
    expect(typeof res.body.alerts.openCount).toBe('number');
    expect(typeof res.body.alerts.acknowledgedCount).toBe('number');
    expect(typeof res.body.alerts.total).toBe('number');
  });

  it('6. não expõe dados sensíveis (connection strings, passwords, tokens)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/monitoring/system-health');
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/password|secret|token|DATABASE_URL|JWT_SECRET/i);
  });

  it('7. retorna status geral (ok/degraded/down)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/monitoring/system-health');
    expect(res.status).toBe(200);
    expect(['ok', 'degraded', 'down']).toContain(res.body.status);
  });

  it('8. retorna timestamp e uptime', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/monitoring/system-health');
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });
});

describe('LGPD', () => {
  it('deve retornar dashboard LGPD (admin)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/lgpd/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.users.total).toBeGreaterThanOrEqual(4);
    expect(res.body.data_stored.audit_logs).toBeDefined();
  });
});

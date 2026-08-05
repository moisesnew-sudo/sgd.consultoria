import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { loginAs, admin, gestor } from './helpers.js';

describe('Permissions - Admin-only routes', () => {
  const adminRoutes: { method: 'get' | 'post' | 'put' | 'delete'; path: string }[] = [
    { method: 'get', path: '/api/sessions' },
    { method: 'get', path: '/api/backups' },
    { method: 'get', path: '/api/lgpd/dashboard' },
    { method: 'get', path: '/api/permissions' },
  ];

  for (const route of adminRoutes) {
    it(`deve permitir admin acessar ${route.method.toUpperCase()} ${route.path}`, async () => {
      const agent = await loginAs(admin.email, admin.password);
      const res = await agent[route.method](route.path);
      expect([200, 404]).toContain(res.status);
    });

    it(`deve rejeitar gestor acessar ${route.method.toUpperCase()} ${route.path}`, async () => {
      const agent = await loginAs(gestor.email, gestor.password);
      const res = await agent[route.method](route.path);
      expect([403, 404]).toContain(res.status);
    });
  }
});

describe('Permissions - Authenticated-only routes', () => {
  it('deve permitir gestor acessar demands (view)', async () => {
    const agent = await loginAs(gestor.email, gestor.password);
    const res = await agent.get('/api/demands');
    expect(res.status).toBe(200);
  });

  it('deve permitir qualquer usuário autenticado acessar health check', async () => {
    const agent = await loginAs(gestor.email, gestor.password);
    const res = await agent.get('/api/monitoring/health');
    expect(res.status).toBe(200);
  });

  it('deve rejeitar health check sem token', async () => {
    const res = await request(app).get('/api/monitoring/health');
    expect(res.status).toBe(401);
  });
});

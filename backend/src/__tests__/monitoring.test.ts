import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { loginAs, admin } from './helpers.js';

describe('Monitoring', () => {
  it('deve retornar health check', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .get('/api/monitoring/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.server).toBeDefined();
    expect(res.body.database).toBeDefined();
    expect(res.body.api).toBeDefined();
  });
});

describe('LGPD', () => {
  it('deve retornar dashboard LGPD (admin)', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .get('/api/lgpd/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.users.total).toBeGreaterThanOrEqual(4);
    expect(res.body.data_stored.audit_logs).toBeDefined();
  });
});

import { describe, it, expect } from 'vitest';
import { loginAs, admin } from './helpers.js';

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

describe('LGPD', () => {
  it('deve retornar dashboard LGPD (admin)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/lgpd/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.users.total).toBeGreaterThanOrEqual(4);
    expect(res.body.data_stored.audit_logs).toBeDefined();
  });
});

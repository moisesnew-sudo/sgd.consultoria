import { describe, it, expect } from 'vitest';
import { loginAs, loginAsWithCsrf, admin } from './helpers.js';

describe('Audit', () => {
  it('deve listar logs de auditoria (admin)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/audit');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('deve retornar dashboard-stats (admin)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/audit/dashboard-stats');
    expect(res.status).toBe(200);
    expect(res.body.total_logins).toBeDefined();
    expect(res.body.active_users).toBeDefined();
    expect(res.body.active_sessions).toBeDefined();
  });

  it('deve filtrar dashboard-stats por data (admin)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/audit/dashboard-stats?start_date=2026-01-01&end_date=2026-12-31');
    expect(res.status).toBe(200);
    expect(res.body.total_logins).toBeDefined();
  });

  it('deve registrar exportação', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post('/api/audit/log-export')
      .set('X-CSRF-Token', csrfToken)
      .send({ export_type: 'excel', record_count: 10, filters: { status: 'pendente' } });
    expect(res.status).toBe(200);
  });

  it('deve rejeitar export_type inválido', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post('/api/audit/log-export')
      .set('X-CSRF-Token', csrfToken)
      .send({ export_type: 'txt', record_count: 10 });
    expect(res.status).toBe(400);
  });

  it('deve rejeitar acesso ao audit para usuário sem permissão', async () => {
    const agent = await loginAs('analista@sgd.gov.br', 'Analista2026!');
    const res = await agent.get('/api/audit');
    expect(res.status).toBe(403);
  });
});

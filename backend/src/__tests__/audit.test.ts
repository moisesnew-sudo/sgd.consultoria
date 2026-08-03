import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { loginAs, admin } from './helpers.js';

describe('Audit', () => {
  it('deve listar logs de auditoria (admin)', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('deve retornar dashboard-stats (admin)', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .get('/api/audit/dashboard-stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total_logins).toBeDefined();
    expect(res.body.active_users).toBeDefined();
    expect(res.body.active_sessions).toBeDefined();
  });

  it('deve filtrar dashboard-stats por data (admin)', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .get('/api/audit/dashboard-stats?start_date=2026-01-01&end_date=2026-12-31')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total_logins).toBeDefined();
  });

  it('deve registrar exportação', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .post('/api/audit/log-export')
      .set('Authorization', `Bearer ${token}`)
      .send({ export_type: 'excel', record_count: 10, filters: { status: 'pendente' } });
    expect(res.status).toBe(200);
  });

  it('deve rejeitar export_type inválido', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .post('/api/audit/log-export')
      .set('Authorization', `Bearer ${token}`)
      .send({ export_type: 'txt', record_count: 10 });
    expect(res.status).toBe(400);
  });

  it('deve rejeitar acesso ao audit para usuário sem permissão', async () => {
    const token = await loginAs('analista@sgd.gov.br', 'Analista2026!');
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

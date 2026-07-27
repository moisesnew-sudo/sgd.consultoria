import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { loginAs, admin } from './helpers.js';

describe('Sessions', () => {
  it('deve listar sessões ativas (admin)', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('deve listar minhas próprias sessões', async () => {
    const token = await loginAs(admin.email, admin.password);
    const res = await request(app)
      .get('/api/sessions/my-sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('deve rejeitar listagem de sessões para não-admin', async () => {
    const token = await loginAs('gestor@sgd.gov.br', 'Gestor2026!');
    const res = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

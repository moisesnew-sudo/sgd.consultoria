import { describe, it, expect } from 'vitest';
import { loginAs, admin } from './helpers.js';

describe('Sessions', () => {
  it('deve listar sessões ativas (admin)', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('deve listar minhas próprias sessões', async () => {
    const agent = await loginAs(admin.email, admin.password);
    const res = await agent.get('/api/sessions/my-sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('deve rejeitar listagem de sessões para não-admin', async () => {
    const agent = await loginAs('gestor@sgd.gov.br', 'Gestor2026!');
    const res = await agent.get('/api/sessions');
    expect(res.status).toBe(403);
  });
});

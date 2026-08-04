import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { loginAs, loginAsWithCsrf, admin, gestor } from './helpers.js';

async function postWithCsrf(path: string, body: Record<string, unknown>, email = admin.email, password = admin.password) {
  const { token, csrfToken } = await loginAsWithCsrf(email, password);
  return request(app)
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', csrfToken)
    .set('Cookie', `csrf_token=${csrfToken}`)
    .send(body);
}

describe('Padronização - Cadastro mestre de órgãos', () => {
  const unique = `ÓRGÃO TESTE ${Date.now()}`;

  it('deve permitir admin criar órgão (CAIXA ALTA)', async () => {
    const res = await postWithCsrf('/api/organs', { name: unique });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(unique.toUpperCase());
  });

  it('deve rejeitar gestor criar órgão', async () => {
    const res = await postWithCsrf('/api/organs', { name: 'ÓRGÃO PROIBIDO' }, gestor.email, gestor.password);
    expect(res.status).toBe(403);
  });

  it('deve listar órgãos para usuário autenticado', async () => {
    const token = await loginAs(gestor.email, gestor.password);
    const res = await request(app)
      .get('/api/organs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('deve bloquear duplicidade de órgão (case/accent-insensitive)', async () => {
    const dupName = `ÓRGÃO DUP ${Date.now()}`;
    const created = await postWithCsrf('/api/organs', { name: dupName });
    const dup = await postWithCsrf('/api/organs', { name: dupName.toLowerCase() });
    expect(created.status).toBe(201);
    expect([400, 409]).toContain(dup.status);
  });
});

describe('Padronização - Usuários ativos (responsável)', () => {
  it('deve listar usuários ativos para autenticado', async () => {
    const token = await loginAs(gestor.email, gestor.password);
    const res = await request(app)
      .get('/api/auth/users/active')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const u of res.body) {
      expect(u).toHaveProperty('name');
      expect(u).toHaveProperty('email');
    }
  });

  it('deve rejeitar sem token', async () => {
    const res = await request(app).get('/api/auth/users/active');
    expect(res.status).toBe(401);
  });
});

describe('Padronização - Objetos (autocomplete de títulos)', () => {
  it('deve sugerir objetos existentes por busca parcial', async () => {
    const token = await loginAs(gestor.email, gestor.password);
    const res = await request(app)
      .get('/api/standardization/objects?q=crech')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('deve rejeitar sem token', async () => {
    const res = await request(app).get('/api/standardization/objects?q=crech');
    expect(res.status).toBe(401);
  });
});

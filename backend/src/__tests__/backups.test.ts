import { describe, it, expect } from 'vitest';
import { loginAsWithCsrf, admin } from './helpers.js';

describe('Backups', () => {
  it('deve criar um backup manual (admin)', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post('/api/backups')
      .set('X-CSRF-Token', csrfToken)
      .send({ type: 'manual' });
    expect(res.status).toBe(201);
    expect(res.body.filename).toBeDefined();
    expect(res.body.sha256_hash).toBeDefined();
    expect(res.body.status).toBe('completed');
  });

  it('deve listar backups (admin)', async () => {
    const { agent } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent.get('/api/backups');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('deve verificar integridade de um backup', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);

    const createRes = await agent
      .post('/api/backups')
      .set('X-CSRF-Token', csrfToken)
      .send({ type: 'manual' });
    expect(createRes.status).toBe(201);
    const backupId = createRes.body.id;

    const verifyRes = await agent
      .post(`/api/backups/${backupId}/verify`)
      .set('X-CSRF-Token', csrfToken);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
  });

  it('deve rejeitar criação de backup com tipo inválido', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post('/api/backups')
      .set('X-CSRF-Token', csrfToken)
      .send({ type: 'invalido' });
    expect(res.status).toBe(400);
  });
});

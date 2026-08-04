import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { loginAsWithCsrf, admin } from './helpers.js';

describe('Backups', () => {
  it('deve criar um backup manual (admin)', async () => {
    const { token, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await request(app)
      .post('/api/backups')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({ type: 'manual' });
    expect(res.status).toBe(201);
    expect(res.body.filename).toBeDefined();
    expect(res.body.sha256_hash).toBeDefined();
    expect(res.body.status).toBe('completed');
  });

  it('deve listar backups (admin)', async () => {
    const { token } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await request(app)
      .get('/api/backups')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('deve verificar integridade de um backup', async () => {
    const { token, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);

    const createRes = await request(app)
      .post('/api/backups')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({ type: 'manual' });
    expect(createRes.status).toBe(201);
    const backupId = createRes.body.id;

    const verifyRes = await request(app)
      .post(`/api/backups/${backupId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
  });

  it('deve rejeitar criação de backup com tipo inválido', async () => {
    const { token, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await request(app)
      .post('/api/backups')
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({ type: 'invalido' });
    expect(res.status).toBe(400);
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('Password Reset', () => {
  it('deve solicitar reset para email válido', async () => {
    const res = await request(app)
      .post('/api/password-reset/request')
      .send({ email: 'admin@sgd.gov.br' });
    expect(res.status).toBe(200);
  });

  it('deve retornar 200 mesmo para email inexistente (segurança)', async () => {
    const res = await request(app)
      .post('/api/password-reset/request')
      .send({ email: 'naoexiste@teste.com' });
    expect(res.status).toBe(200);
  });

  it('deve rejeitar token inválido no reset', async () => {
    const res = await request(app)
      .post('/api/password-reset/reset')
      .send({ token: 'token_invalido', password: 'NovaSenha123!' });
    expect(res.status).toBe(400);
  });

  it('deve rejeitar senha fraca no reset', async () => {
    const res = await request(app)
      .post('/api/password-reset/reset')
      .send({ token: 'qualquer', password: '123' });
    expect(res.status).toBe(400);
  });
});

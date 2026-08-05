import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  return agent;
}

describe('Auth - Login', () => {
  it('deve autenticar admin com credenciais válidas', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@sgd.gov.br', password: 'Admin2026!' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie).toBeDefined();
    expect(setCookie!.some(c => c.startsWith('token='))).toBe(true);
  });

  it('deve autenticar gestor com credenciais válidas', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'gestor@sgd.gov.br', password: 'Gestor2026!' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('gestor');
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie).toBeDefined();
    expect(setCookie!.some(c => c.startsWith('token='))).toBe(true);
  });

  it('deve rejeitar senha incorreta', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@sgd.gov.br', password: 'senha_errada' });
    expect(res.status).toBe(401);
  });

  it('deve rejeitar email não cadastrado', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'naoexiste@teste.com', password: 'qualquer' });
    expect(res.status).toBe(401);
  });

  it('deve rejeitar formato de email inválido', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invalido', password: 'Admin2026!' });
    expect(res.status).toBe(400);
  });
});

describe('Auth - Profile', () => {
  it('deve retornar perfil do usuário autenticado', async () => {
    const agent = await loginAgent('admin@sgd.gov.br', 'Admin2026!');
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin@sgd.gov.br');
  });

  it('deve rejeitar requisição sem token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('deve rejeitar token inválido', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'token=token_invalido');
    expect(res.status).toBe(401);
  });
});

describe('Auth - Lockout', () => {
  it('deve bloquear conta existente após 5 tentativas falhas', async () => {
    const email = 'analista@sgd.gov.br';
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'senha_errada' });
    }
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Analista2026!' });
    expect(res.status).toBe(429);
  });
});

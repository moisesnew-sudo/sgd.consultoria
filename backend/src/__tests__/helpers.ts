import request from 'supertest';
import app from '../server.js';

export async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

export const admin = { email: 'admin@sgd.gov.br', password: 'Admin2026!' };
export const gestor = { email: 'gestor@sgd.gov.br', password: 'Gestor2026!' };

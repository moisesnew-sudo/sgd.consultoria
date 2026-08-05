import request from 'supertest';
import app from '../server.js';
import type { SuperAgentTest } from 'supertest';

export async function loginAs(email: string, password: string): Promise<SuperAgentTest> {
  const agent = request.agent(app) as unknown as SuperAgentTest;
  const res = await agent
    .post('/api/auth/login')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export async function loginAsWithCsrf(email: string, password: string): Promise<{ agent: SuperAgentTest; csrfToken: string }> {
  const agent = request.agent(app) as unknown as SuperAgentTest;
  const res = await agent
    .post('/api/auth/login')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  let csrfToken = '';
  if (setCookie) {
    for (const entry of setCookie) {
      const m = entry.match(/^csrf_token=([^;]+)/);
      if (m) { csrfToken = m[1]; break; }
    }
  }
  if (!csrfToken) throw new Error('No csrf_token cookie in login response');
  return { agent, csrfToken };
}

export const admin = { email: 'admin@sgd.gov.br', password: 'Admin2026!' };
export const gestor = { email: 'gestor@sgd.gov.br', password: 'Gestor2026!' };

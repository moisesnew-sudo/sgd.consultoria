import request from 'supertest';
import app from '../server.js';
import type { SuperAgentTest } from 'supertest';

interface CachedAuth {
  agent: SuperAgentTest;
  csrfToken: string;
}

const authCache = new Map<string, CachedAuth>();

function extractCsrfToken(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  if (setCookie) {
    for (const entry of setCookie) {
      const match = entry.match(/^csrf_token=([^;]+)/);
      if (match) return match[1];
    }
  }
  throw new Error('No csrf_token cookie in login response');
}

async function getCachedAuth(email: string, password: string): Promise<CachedAuth> {
  const cached = authCache.get(email);
  if (cached) return cached;

  const agent = request.agent(app) as unknown as SuperAgentTest;
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const auth = { agent, csrfToken: extractCsrfToken(res) };
  authCache.set(email, auth);
  return auth;
}

export async function loginAs(email: string, password: string): Promise<SuperAgentTest> {
  return (await getCachedAuth(email, password)).agent;
}

export async function loginAsWithCsrf(email: string, password: string): Promise<{ agent: SuperAgentTest; csrfToken: string }> {
  return getCachedAuth(email, password);
}

export const admin = { email: 'admin@sgd.gov.br', password: 'Admin2026!' };
export const gestor = { email: 'gestor@sgd.gov.br', password: 'Gestor2026!' };

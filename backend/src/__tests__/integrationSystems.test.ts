import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../server.js';
import { get, run, all } from '../database.js';
import { loginAsWithCsrf } from './helpers.js';

type SuperAgentTest = Awaited<ReturnType<typeof loginAsWithCsrf>>['agent'];

let adminAgent: SuperAgentTest;
let adminCsrfToken: string;
let gestorAgent: SuperAgentTest;
let gestorCsrfToken: string;
let noPermAgent: SuperAgentTest;

const testSystems: number[] = [];
const NO_PERM_EMAIL = 'noperm-integration@sgd.gov.br';
const NO_PERM_PASSWORD = 'NoPerm@2026!';

function uniqueCode(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function withCsrf(agent: SuperAgentTest, csrfToken: string, method: 'post' | 'put' | 'patch', url: string, body?: any) {
  return agent[method](url)
    .set('x-csrf-token', csrfToken)
    .set('Cookie', `csrf_token=${csrfToken}`)
    .send(body ?? {});
}

beforeAll(async () => {
  process.env.TEST_SECRET = 'test-secret-value';

  const adminLogin = await loginAsWithCsrf('admin@sgd.gov.br', 'Admin2026!');
  adminAgent = adminLogin.agent;
  adminCsrfToken = adminLogin.csrfToken;

  const gestorLogin = await loginAsWithCsrf('gestor@sgd.gov.br', 'Gestor2026!');
  gestorAgent = gestorLogin.agent;
  gestorCsrfToken = gestorLogin.csrfToken;

  // Usuário sem nenhuma permissão de integração — valida acesso negado na leitura.
  const existingNoPerm = await get('SELECT id FROM users WHERE email = $1', [NO_PERM_EMAIL]);
  if (!existingNoPerm) {
    const hash = await bcrypt.hash(NO_PERM_PASSWORD, 10);
    await run(
      "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'consulta')",
      [NO_PERM_EMAIL, hash, 'Sem Permissão Integração']
    );
  }
  const noPermLogin = await loginAsWithCsrf(NO_PERM_EMAIL, NO_PERM_PASSWORD);
  noPermAgent = noPermLogin.agent;
});

afterAll(async () => {
  if (testSystems.length > 0) {
    await run('DELETE FROM integration_logs WHERE system_id = ANY($1::int[])', [testSystems]);
    await run('DELETE FROM audit_logs WHERE entity_type = $1 AND entity_id = ANY($2::text[])', ['integration_system', testSystems.map(String)]);
    await run('DELETE FROM integration_systems WHERE id = ANY($1::int[])', [testSystems]);
  }
  await run('DELETE FROM audit_logs WHERE user_id = (SELECT id FROM users WHERE email = $1)', [NO_PERM_EMAIL]);
  await run('DELETE FROM users WHERE email = $1', [NO_PERM_EMAIL]);
});

describe('Integrações - Administração de Sistemas (Fase 3.1)', () => {
  describe('GET /api/integrations/systems', () => {
    it('deve listar sistemas (admin)', async () => {
      const res = await adminAgent.get('/api/integrations/systems');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();

      // Se houver sistemas, verifica estrutura
      if (res.body.data.length > 0) {
        const system = res.body.data[0];
        expect(system.secretConfigured).toBe(true);
        expect(system).not.toHaveProperty('secret_env_key');
      }
    });

    it('deve permitir usuário com permissão integrations.view listar (gestor)', async () => {
      const res = await gestorAgent.get('/api/integrations/systems');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('deve rejeitar usuário sem permissão integrations.view', async () => {
      const res = await noPermAgent.get('/api/integrations/systems');
      expect(res.status).toBe(403);
    });

    it('deve rejeitar requisição sem autenticação', async () => {
      const res = await request(app).get('/api/integrations/systems');
      expect(res.status).toBe(401);
    });

    it('deve suportar paginação', async () => {
      const res = await adminAgent.get('/api/integrations/systems?page=1&limit=2');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(2);
    });

    it('deve suportar filtro por active', async () => {
      const res = await adminAgent.get('/api/integrations/systems?active=true');
      expect(res.status).toBe(200);
      expect(res.body.data.every((s: any) => s.active === true)).toBe(true);
    });

    it('deve suportar busca', async () => {
      const res = await adminAgent.get('/api/integrations/systems?search=transferegov');
      expect(res.status).toBe(200);
      expect(res.body.data.some((s: any) => s.code === 'transferegov')).toBe(true);
    });
  });

  describe('GET /api/integrations/systems/:id', () => {
    it('deve buscar sistema por ID (admin)', async () => {
      const listRes = await adminAgent.get('/api/integrations/systems');
      const system = listRes.body.data[0];

      const res = await adminAgent.get(`/api/integrations/systems/${system.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(system.id);
      expect(res.body.code).toBe(system.code);
      expect(res.body.secretConfigured).toBe(true);
      expect(res.body).not.toHaveProperty('secret_env_key');
    });

    it('deve retornar 404 para sistema inexistente', async () => {
      const res = await adminAgent.get('/api/integrations/systems/999999');
      expect(res.status).toBe(404);
    });

    it('deve retornar 400 para ID inválido', async () => {
      const res = await adminAgent.get('/api/integrations/systems/invalido');
      expect(res.status).toBe(400);
    });

    it('deve permitir usuário com permissão integrations.view acessar detalhe (gestor)', async () => {
      const listRes = await adminAgent.get('/api/integrations/systems');
      const system = listRes.body.data[0];

      const res = await gestorAgent.get(`/api/integrations/systems/${system.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(system.id);
    });
  });

  describe('POST /api/integrations/systems', () => {
    it('deve criar sistema válido (admin)', async () => {
      const code = uniqueCode('test');
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code,
        name: 'Sistema Teste',
        description: 'Descrição do sistema de teste',
        secret_env_key: 'TEST_SECRET',
        config: { endpoint: 'https://api.test.com' },
      });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(code);
      expect(res.body.name).toBe('Sistema Teste');
      expect(res.body.description).toBe('Descrição do sistema de teste');
      expect(res.body.secretConfigured).toBe(true);
      expect(res.body).not.toHaveProperty('secret_env_key');
      expect(res.body.active).toBe(true);
      expect(res.body.config).toEqual({ endpoint: 'https://api.test.com' });

      testSystems.push(res.body.id);
    });

    it('deve retornar secretConfigured false quando a env do secret não existe', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: uniqueCode('nosecret'),
        name: 'Sistema Sem Secret',
        secret_env_key: 'ENV_VAR_NAO_EXISTENTE_XYZ',
      });

      expect(res.status).toBe(201);
      expect(res.body.secretConfigured).toBe(false);

      testSystems.push(res.body.id);
    });

    it('deve persistir description na criação e leitura', async () => {
      const code = uniqueCode('desc');
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code,
        name: 'Sistema Desc',
        description: 'Minha descrição',
        secret_env_key: 'DESC_SECRET',
      });

      expect(res.status).toBe(201);
      expect(res.body.description).toBe('Minha descrição');

      testSystems.push(res.body.id);

      const detail = await adminAgent.get(`/api/integrations/systems/${res.body.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.description).toBe('Minha descrição');
    });

    it('deve rejeitar code duplicado', async () => {
      const code = uniqueCode('dup');
      await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code,
        name: 'Sistema Original',
        secret_env_key: 'SECRET_1',
      });

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code,
        name: 'Sistema Duplicado',
        secret_env_key: 'SECRET_2',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Já existe um sistema com este code');
    });

    it('deve rejeitar code duplicado case-insensitive (regex valida lowercase)', async () => {
      const baseCode = uniqueCode('case');
      await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: baseCode.toLowerCase(),
        name: 'Sistema Lower',
        secret_env_key: 'SECRET_LOWER',
      });

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: baseCode.toUpperCase(),
        name: 'Sistema Upper',
        secret_env_key: 'SECRET_UPPER',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('letras minúsculas');
    });

    it('deve rejeitar name obrigatório', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: uniqueCode('noname'),
        secret_env_key: 'SECRET',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Required');
    });

    it('deve rejeitar config inválido', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: uniqueCode('badconfig'),
        name: 'Sistema Config Ruim',
        secret_env_key: 'SECRET',
        config: 'not a json',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Expected object');
    });

    it('deve rejeitar sem CSRF', async () => {
      const res = await adminAgent
        .post('/api/integrations/systems')
        .send({
          code: uniqueCode('nocsrf'),
          name: 'Sistema Sem CSRF',
          secret_env_key: 'SECRET',
        });

      expect(res.status).toBe(403);
    });

    it('deve rejeitar usuário sem permissão', async () => {
      const res = await withCsrf(gestorAgent, gestorCsrfToken, 'post', '/api/integrations/systems', {
        code: uniqueCode('noperm'),
        name: 'Sistema Sem Permissão',
        secret_env_key: 'SECRET',
      });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/integrations/systems/:id', () => {
    let systemId: number;

    beforeAll(async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: uniqueCode('update'),
        name: 'Sistema Para Atualizar',
        secret_env_key: 'UPDATE_SECRET',
        config: { old: 'value' },
      });
      systemId = res.body.id;
      testSystems.push(systemId);
    });

    it('deve atualizar name (admin)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        name: 'Nome Atualizado',
      });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Nome Atualizado');
      expect(res.body.code).toBeDefined();
    });

    it('deve atualizar config', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        config: { new: 'config', another: 'value' },
      });

      expect(res.status).toBe(200);
      expect(res.body.config).toEqual({ new: 'config', another: 'value' });
    });

    it('deve atualizar description', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        description: 'Descrição atualizada',
      });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Descrição atualizada');
    });

    it('deve rejeitar alteração de code', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        code: 'novo-code',
      });

      expect(res.status).toBe(400);
    });

    it('deve rejeitar alteração de secret_env_key', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        secret_env_key: 'NOVO_SECRET',
      });

      expect(res.status).toBe(400);
    });

    it('deve rejeitar atualização parcial inválida (config não JSON)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        config: 'invalid json string',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Expected object');
    });

    it('deve rejeitar sem CSRF', async () => {
      const res = await adminAgent
        .put(`/api/integrations/systems/${systemId}`)
        .send({ name: 'Test' });

      expect(res.status).toBe(403);
    });

    it('deve retornar 404 para sistema inexistente', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', '/api/integrations/systems/999999', { name: 'Test' });

      expect(res.status).toBe(404);
    });

    it('deve permitir atualização parcial (apenas name)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, { name: 'Apenas Nome' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Apenas Nome');
    });
  });

  describe('PATCH /api/integrations/systems/:id/activate', () => {
    let systemId: number;

    beforeAll(async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: uniqueCode('activate'),
        name: 'Sistema Para Ativar',
        secret_env_key: 'ACTIVATE_SECRET',
      });
      systemId = res.body.id;
      testSystems.push(systemId);

      await withCsrf(adminAgent, adminCsrfToken, 'patch', `/api/integrations/systems/${systemId}/deactivate`);
    });

    it('deve ativar sistema inativo (admin)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'patch', `/api/integrations/systems/${systemId}/activate`);

      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);
    });

    it('deve ser idempotente (ativar já ativo)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'patch', `/api/integrations/systems/${systemId}/activate`);

      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);
    });

    it('deve rejeitar sem CSRF', async () => {
      const res = await adminAgent
        .patch(`/api/integrations/systems/${systemId}/activate`);

      expect(res.status).toBe(403);
    });

    it('deve retornar 404 para sistema inexistente', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'patch', '/api/integrations/systems/999999/activate');

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/integrations/systems/:id/deactivate', () => {
    let systemId: number;

    beforeAll(async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: uniqueCode('deactivate'),
        name: 'Sistema Para Desativar',
        secret_env_key: 'DEACTIVATE_SECRET',
      });
      systemId = res.body.id;
      testSystems.push(systemId);
    });

    it('deve desativar sistema ativo (admin)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'patch', `/api/integrations/systems/${systemId}/deactivate`);

      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);
    });

    it('deve ser idempotente (desativar já desativado)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'patch', `/api/integrations/systems/${systemId}/deactivate`);

      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);
    });

    it('deve rejeitar sem CSRF', async () => {
      const res = await adminAgent
        .patch(`/api/integrations/systems/${systemId}/deactivate`);

      expect(res.status).toBe(403);
    });

    it('deve retornar 404 para sistema inexistente', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'patch', '/api/integrations/systems/999999/deactivate');

      expect(res.status).toBe(404);
    });
  });

  describe('Auditoria e logs', () => {
    it('deve registrar auditoria ao criar sistema', async () => {
      const code = uniqueCode('audit');
      await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code,
        name: 'Sistema Auditoria',
        secret_env_key: 'AUDIT_SECRET',
      });

      const system = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', [code]);
      const audit = await get('SELECT * FROM audit_logs WHERE entity_type = $1 AND entity_id = $2', ['integration_system', String(system?.id)]);

      expect(audit).toBeTruthy();
      expect(audit?.action).toBe('integration.system.created');
      const details = typeof audit?.details === 'string' ? JSON.parse(audit.details) : audit?.details;
      expect(details.system.code).toBe(code);
      expect(details.system.secret_env_key).toBe('[REDACTED]');
    });

    it('deve registrar log de integração ao criar sistema', async () => {
      const code = uniqueCode('log');
      await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code,
        name: 'Sistema Log',
        secret_env_key: 'LOG_SECRET',
      });

      const system = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', [code]);
      const logs = await all('SELECT * FROM integration_logs WHERE system_id = $1 AND action = $2', [system?.id, 'integration.system.created']);

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].status).toBe('success');
    });
  });

  describe('C4.1 - Proteção de configurações sensíveis', () => {
    let systemId: number;
    const SECRET_CONFIG = {
      endpoint: 'https://api.x.com',
      api_key: 'REAL_API_KEY_123',
      password: 'REAL_PASS_456',
      client_secret: 'CS_999',
    };

    beforeAll(async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
        code: uniqueCode('c41'),
        name: 'Sistema C4.1 Secreto',
        secret_env_key: 'TEST_SECRET',
        config: SECRET_CONFIG,
      });
      expect(res.status).toBe(201);
      systemId = res.body.id;
      testSystems.push(systemId);
    });

    it('1. gestor (integrations.view) — GET /systems não deve conter segredo real', async () => {
      const res = await gestorAgent.get('/api/integrations/systems');
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('REAL_API_KEY_123');
      expect(body).not.toContain('REAL_PASS_456');
      expect(body).not.toContain('CS_999');
    });

    it('2. gestor (integrations.view) — GET /systems/:id deve mascarar config', async () => {
      const res = await gestorAgent.get(`/api/integrations/systems/${systemId}`);
      expect(res.status).toBe(200);
      expect(res.body.config.api_key).toBe('[REDACTED]');
      expect(res.body.config.password).toBe('[REDACTED]');
      expect(res.body.config.client_secret).toBe('[REDACTED]');
      expect(res.body.config.endpoint).toBe('https://api.x.com');
    });

    it('3. admin (integrations.manage) — pode ver valores reais e editar', async () => {
      const detail = await adminAgent.get(`/api/integrations/systems/${systemId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.config.api_key).toBe('REAL_API_KEY_123');

      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        name: 'Sistema C4.1 Renomeado',
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Sistema C4.1 Renomeado');
    });

    it('4. atualização sem alterar segredo (envio de [REDACTED]) mantém valor existente', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        config: {
          endpoint: 'https://api.x.com',
          api_key: '[REDACTED]',
          password: '[REDACTED]',
          client_secret: '[REDACTED]',
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.config.api_key).toBe('REAL_API_KEY_123');
      expect(res.body.config.password).toBe('REAL_PASS_456');

      const db = await get<{ config: any }>('SELECT config FROM integration_systems WHERE id = $1', [systemId]);
      expect(db?.config?.api_key).toBe('REAL_API_KEY_123');
      expect(db?.config?.password).toBe('REAL_PASS_456');
    });

    it('5. atualização alterando segredo atualiza corretamente', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'put', `/api/integrations/systems/${systemId}`, {
        config: {
          endpoint: 'https://api.x.com',
          api_key: 'NOVO_API_KEY',
          password: '[REDACTED]',
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.config.api_key).toBe('NOVO_API_KEY');
      expect(res.body.config.password).toBe('REAL_PASS_456');

      const db = await get<{ config: any }>('SELECT config FROM integration_systems WHERE id = $1', [systemId]);
      expect(db?.config?.api_key).toBe('NOVO_API_KEY');
      expect(db?.config?.password).toBe('REAL_PASS_456');
    });
  });
});
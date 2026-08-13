import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'crypto';
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
let noPermCsrfToken: string;
let transferegovId: number;
let demandId: string;

const testSystems: number[] = [];
const testEventIds: number[] = [];
const NO_PERM_EMAIL = 'noperm-admin@sgd.gov.br';
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

async function createTestSystem(code: string, config?: any) {
  const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/systems', {
    code,
    name: 'Sistema Admin',
    secret_env_key: 'TEST_SECRET',
    ...(config ? { config } : {}),
  });
  expect(res.status).toBe(201);
  testSystems.push(res.body.id);
  return res.body;
}

beforeAll(async () => {
  process.env.TEST_SECRET = 'test-secret-value';

  const adminLogin = await loginAsWithCsrf('admin@sgd.gov.br', 'Admin2026!');
  adminAgent = adminLogin.agent;
  adminCsrfToken = adminLogin.csrfToken;

  const gestorLogin = await loginAsWithCsrf('gestor@sgd.gov.br', 'Gestor2026!');
  gestorAgent = gestorLogin.agent;
  gestorCsrfToken = gestorLogin.csrfToken;

  const existingNoPerm = await get('SELECT id FROM users WHERE email = $1', [NO_PERM_EMAIL]);
  if (!existingNoPerm) {
    const hash = await bcrypt.hash(NO_PERM_PASSWORD, 10);
    await run(
      "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'consulta')",
      [NO_PERM_EMAIL, hash, 'Sem Permissão Admin']
    );
  }
  const noPermLogin = await loginAsWithCsrf(NO_PERM_EMAIL, NO_PERM_PASSWORD);
  noPermAgent = noPermLogin.agent;
  noPermCsrfToken = noPermLogin.csrfToken;

  const tf = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', ['transferegov']);
  if (!tf) throw new Error('Sistema transferegov não seedado');
  transferegovId = tf.id;
});

afterAll(async () => {
  if (testEventIds.length > 0) {
    await run('DELETE FROM integration_logs WHERE webhook_event_id = ANY($1::int[])', [testEventIds]);
    await run('DELETE FROM webhook_events WHERE id = ANY($1::int[])', [testEventIds]);
  }
  if (demandId) {
    await run('DELETE FROM audit_logs WHERE action = $1 AND entity_id = $2', ['integration_sync', demandId]);
    await run('DELETE FROM timeline_events WHERE demand_id = $1', [demandId]);
    await run('DELETE FROM demand_integrations WHERE demand_id = $1', [demandId]);
    await run('DELETE FROM demands WHERE id = $1', [demandId]);
  }
  await run(`DELETE FROM audit_logs WHERE action = 'integration.sync.manual' AND entity_id = ANY($1::text[])`, [testSystems.map(String)]);
  await run("DELETE FROM audit_logs WHERE action = 'integration.sync.manual' AND entity_id = $1", [String(transferegovId)]);
  await run("DELETE FROM audit_logs WHERE action = 'integration.test-connection' AND entity_id = $1", [String(transferegovId)]);
  await run("DELETE FROM integration_logs WHERE system_id = $1 AND action = 'integration.test-connection'", [transferegovId]);
  if (testSystems.length > 0) {
    await run('DELETE FROM integration_logs WHERE system_id = ANY($1::int[])', [testSystems]);
    await run('DELETE FROM audit_logs WHERE entity_type = $1 AND entity_id = ANY($2::text[])', ['integration_system', testSystems.map(String)]);
    await run('DELETE FROM integration_systems WHERE id = ANY($1::int[])', [testSystems]);
  }
  await run(
    `UPDATE integration_systems SET last_sync_at = NULL, last_error_at = NULL, last_error_message = NULL,
       last_http_status = NULL, last_response_ms = NULL, error_count_24h = 0, consecutive_errors = 0
     WHERE id = $1`,
    [transferegovId]
  );
  await run('DELETE FROM audit_logs WHERE user_id = (SELECT id FROM users WHERE email = $1)', [NO_PERM_EMAIL]);
  await run('DELETE FROM users WHERE email = $1', [NO_PERM_EMAIL]);
});

describe('Integrações - Backend Administrativo (Fase 3.1 - Fase B)', () => {
  describe('GET /api/integrations/admin/dashboard', () => {
    it('deve retornar o dashboard (gestor com integrations.view)', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('active');
      expect(res.body).toHaveProperty('inactive');
      expect(res.body).toHaveProperty('lastSync');
      expect(res.body).toHaveProperty('lastError');
      expect(res.body).toHaveProperty('failures24h');
      expect(['healthy', 'warning', 'critical']).toContain(res.body.status);
    });

    it('deve rejeitar usuário sem permissão integrations.view', async () => {
      const res = await noPermAgent.get('/api/integrations/admin/dashboard');
      expect(res.status).toBe(403);
    });

    it('deve rejeitar sem autenticação', async () => {
      const res = await request(app).get('/api/integrations/admin/dashboard');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/integrations/admin/health', () => {
    it('deve listar a saúde dos sistemas (gestor)', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/health');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const row of res.body) {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('name');
        expect(['operational', 'attention', 'failure']).toContain(row.status);
        expect(row).toHaveProperty('lastSync');
        expect(row).toHaveProperty('lastError');
        expect(row).toHaveProperty('httpStatus');
        expect(row).toHaveProperty('responseTime');
        expect(row).toHaveProperty('failures');
      }
    });

    it('deve rejeitar usuário sem permissão', async () => {
      const res = await noPermAgent.get('/api/integrations/admin/health');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/integrations/admin/logs', () => {
    it('deve listar histórico com paginação (gestor)', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/logs?page=1&limit=10');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 10 });
      if (res.body.data.length > 0) {
        const log = res.body.data[0];
        for (const key of ['id', 'system', 'action', 'direction', 'status', 'created_at']) {
          expect(log).toHaveProperty(key);
        }
      }
    });

    it('deve suportar filtros (status, direction)', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/logs?status=success&direction=in');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const log of res.body.data) {
        expect(log.status).toBe('success');
        expect(log.direction).toBe('in');
      }
    });

    it('deve suportar busca', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/logs?search=transferegov');
      expect(res.status).toBe(200);
    });

    it('deve suportar filtro de erro', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/logs?error=true');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/integrations/admin/systems/:id', () => {
    it('deve retornar detalhes com saúde e últimos eventos (gestor)', async () => {
      const res = await gestorAgent.get(`/api/integrations/admin/systems/${transferegovId}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe('transferegov');
      expect(res.body.health).toBeDefined();
      expect(Array.isArray(res.body.recentLogs)).toBe(true);
      expect(res.body).not.toHaveProperty('secret_env_key');
    });

    it('deve redigir chaves sensíveis do config', async () => {
      const system = await createTestSystem(uniqueCode('secretcfg'), {
        endpoint: 'https://api.test.com',
        api_token: 'valor-secreto',
        extra: { nested_secret: 'outro' },
      });
      const res = await gestorAgent.get(`/api/integrations/admin/systems/${system.id}`);
      expect(res.status).toBe(200);
      expect(res.body.config.api_token).toBe('[REDACTED]');
      expect(res.body.config.extra.nested_secret).toBe('[REDACTED]');
      expect(res.body.config.endpoint).toBe('https://api.test.com');
    });

    it('deve retornar 404 para sistema inexistente', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/systems/999999');
      expect(res.status).toBe(404);
    });

    it('deve retornar 400 para ID inválido', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/systems/invalido');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/integrations/admin/adapters', () => {
    it('deve listar adapters registrados (gestor)', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/adapters');
      expect(res.status).toBe(200);
      const codes = res.body.data.map((a: any) => a.code);
      expect(codes).toContain('transferegov');
      expect(codes).toContain('sei');
      expect(codes).toContain('cglog');
    });
  });

  describe('POST /api/integrations/admin/systems/:id/sync', () => {
    it('deve sincronizar com payload (admin) — sucesso, logs e auditoria', async () => {
      const dId = `ADMIN-SYNC-${Date.now()}`;
      await run(
        `INSERT INTO demands (id, title, category, municipality, uf, status, priority, proposal_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [dId, 'DEMANDA ADMIN SYNC', 'INTEGRACAO', 'FORTALEZA', 'CE', 'pendente', 'media', 'PROP-ADMIN-SYNC']
      );
      demandId = dId;

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/sync`, {
        payload: { proposal_number: 'PROP-ADMIN-SYNC', status: 'APROVADO' },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.httpStatus).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.durationMs).toBeGreaterThanOrEqual(0);
      expect(res.body.eventId).toBeDefined();
      testEventIds.push(res.body.eventId);

      const demand = await get<{ status: string }>('SELECT status FROM demands WHERE id = $1', [dId]);
      expect(demand?.status).toBe('concluido');

      const log = await get(
        'SELECT * FROM integration_logs WHERE webhook_event_id = $1',
        [res.body.eventId]
      );
      expect(log).toBeTruthy();
      expect(log.triggered_by).toBe('manual');
      expect(log.http_status).toBe(200);
      expect(log.duration_ms).toBeGreaterThanOrEqual(0);
      expect(log.error_message).toBeNull();

      const audit = await get(
        `SELECT * FROM audit_logs WHERE action = 'integration.sync.manual' AND entity_id = $1`,
        [String(transferegovId)]
      );
      expect(audit).toBeTruthy();

      const sys = await get('SELECT * FROM integration_systems WHERE id = $1', [transferegovId]);
      expect(sys.last_sync_at).toBeTruthy();
      expect(sys.consecutive_errors).toBe(0);
      expect(sys.last_http_status).toBe(200);
    });

    it('deve marcar warning quando o evento não corresponde (payload desconhecido)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/sync`, {
        payload: { proposal_number: 'PROP-ADMIN-SYNC', status: 'DESCONHECIDO' },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('warning');
      if (res.body.eventId) testEventIds.push(res.body.eventId);
    });

    it('deve registrar warning sem payload quando não há endpoint configurado', async () => {
      const system = await createTestSystem(uniqueCode('noendpoint'));

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${system.id}/sync`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('warning');
      expect(res.body.message).toContain('endpoint');

      const logs = await all(
        `SELECT * FROM integration_logs WHERE system_id = $1 AND action = 'integration.sync' AND triggered_by = 'manual'`,
        [system.id]
      );
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('deve rejeitar gestor (sem integrations.sync)', async () => {
      const res = await withCsrf(gestorAgent, gestorCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/sync`, {
        payload: { proposal_number: 'PROP-ADMIN-SYNC', status: 'APROVADO' },
      });
      expect(res.status).toBe(403);
    });

    it('deve rejeitar usuário sem permissão', async () => {
      const res = await withCsrf(noPermAgent, noPermCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/sync`, {
        payload: { proposal_number: 'PROP-ADMIN-SYNC', status: 'APROVADO' },
      });
      expect(res.status).toBe(403);
    });

    it('deve rejeitar sem CSRF', async () => {
      const res = await adminAgent
        .post(`/api/integrations/admin/systems/${transferegovId}/sync`)
        .send({ payload: { proposal_number: 'PROP-ADMIN-SYNC', status: 'APROVADO' } });
      expect(res.status).toBe(403);
    });

    it('deve retornar 404 para sistema inexistente', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/admin/systems/999999/sync', {
        payload: { proposal_number: 'PROP-ADMIN-SYNC', status: 'APROVADO' },
      });
      expect(res.status).toBe(404);
    });

    it('deve rejeitar sistema inativo', async () => {
      const system = await createTestSystem(uniqueCode('inactive'));
      await withCsrf(adminAgent, adminCsrfToken, 'patch', `/api/integrations/systems/${system.id}/deactivate`);

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${system.id}/sync`, {
        payload: { proposal_number: 'PROP-ADMIN-SYNC', status: 'APROVADO' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('inativo');
    });

    it('deve rejeitar payload não-objeto', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/sync`, {
        payload: 'nao-objeto',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Payload');
    });
  });

  describe('GET /api/integrations/admin/overview (visão operacional E3.1)', () => {
    it('deve retornar resumo, sistemas, alertas e scheduler (gestor)', async () => {
      const res = await gestorAgent.get('/api/integrations/admin/overview');
      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary).toHaveProperty('total');
      expect(res.body.summary).toHaveProperty('active');
      expect(res.body.summary).toHaveProperty('inactive');
      expect(res.body.summary).toHaveProperty('healthy');
      expect(res.body.summary).toHaveProperty('attention');
      expect(res.body.summary).toHaveProperty('failure');
      expect(res.body.summary).toHaveProperty('failures24h');
      expect(res.body.summary).toHaveProperty('openAlerts');
      expect(res.body.summary).toHaveProperty('avgLatencyMs');
      expect(res.body.summary).toHaveProperty('lastSync');
      expect(Array.isArray(res.body.systems)).toBe(true);
      expect(Array.isArray(res.body.alerts)).toBe(true);
      expect(res.body.scheduler).toHaveProperty('running');
      expect(res.body.scheduler).toHaveProperty('lastCycleAt');

      const tf = res.body.systems.find((s: any) => s.code === 'transferegov');
      expect(tf).toBeDefined();
      expect(tf).toHaveProperty('healthStatus');
      expect(tf).toHaveProperty('lastSyncAt');
      expect(tf).toHaveProperty('nextSyncAt');
      expect(tf).toHaveProperty('responseTime');
      expect(tf).toHaveProperty('consecutiveErrors');
      expect(Array.isArray(tf.alerts)).toBe(true);
    });

    it('deve respeitar permissão integrations.view', async () => {
      const res = await noPermAgent.get('/api/integrations/admin/overview');
      expect(res.status).toBe(403);
    });

    it('deve rejeitar sem autenticação', async () => {
      const res = await request(app).get('/api/integrations/admin/overview');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/integrations/admin/systems/:id/test-connection (E3.1)', () => {
    it('deve testar conexão e retornar resultado com latência (admin)', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/test-connection`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success');
      expect(res.body).toHaveProperty('status');
      expect(['success', 'error']).toContain(res.body.status);
      expect(res.body).toHaveProperty('httpStatus');
      expect(res.body).toHaveProperty('durationMs');
      expect(res.body.durationMs).toBeGreaterThanOrEqual(0);

      const log = await get(
        `SELECT * FROM integration_logs WHERE system_id = $1 AND action = 'integration.test-connection' ORDER BY id DESC LIMIT 1`,
        [transferegovId]
      );
      expect(log).toBeTruthy();
      expect(log.direction).toBe('out');
      expect(log.triggered_by).toBe('manual');
      expect(log.duration_ms).toBeGreaterThanOrEqual(0);

      const audit = await get(
        `SELECT * FROM audit_logs WHERE action = 'integration.test-connection' AND entity_id = $1`,
        [String(transferegovId)]
      );
      expect(audit).toBeTruthy();
    });

    it('deve rejeitar gestor (sem integrations.sync)', async () => {
      const res = await withCsrf(gestorAgent, gestorCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/test-connection`);
      expect(res.status).toBe(403);
    });

    it('deve rejeitar usuário sem permissão', async () => {
      const res = await withCsrf(noPermAgent, noPermCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/test-connection`);
      expect(res.status).toBe(403);
    });

    it('deve retornar 404 para sistema inexistente', async () => {
      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', '/api/integrations/admin/systems/999999/test-connection');
      expect(res.status).toBe(404);
    });

    it('deve rejeitar sistema inativo', async () => {
      const system = await createTestSystem(uniqueCode('inactive-tc'));
      await withCsrf(adminAgent, adminCsrfToken, 'patch', `/api/integrations/systems/${system.id}/deactivate`);

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${system.id}/test-connection`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('inativo');
    });

    it('deve rejeitar sem CSRF', async () => {
      const res = await adminAgent.post(`/api/integrations/admin/systems/${transferegovId}/test-connection`);
      expect(res.status).toBe(403);
    });
  });

  describe('Fail-fast de configuração (Fase 2.1)', () => {
    let originalConfig: unknown;

    beforeAll(async () => {
      const row = await get('SELECT config FROM integration_systems WHERE id = $1', [transferegovId]);
      originalConfig = row ? row.config : null;
    });

    afterEach(async () => {
      if (originalConfig === null) {
        await run('UPDATE integration_systems SET config = NULL WHERE id = $1', [transferegovId]);
      } else {
        await run('UPDATE integration_systems SET config = $2 WHERE id = $1', [transferegovId, JSON.stringify(originalConfig)]);
      }
      delete process.env.TRANSFEREGOV_API_KEY;
      delete process.env.TRANSFEREGOV_WEBHOOK_SECRET;
      vi.unstubAllGlobals();
    });

    it('test-connection: configuração inválida bloqueia antes de qualquer HTTP', async () => {
      await run('UPDATE integration_systems SET config = $2 WHERE id = $1', [
        transferegovId,
        JSON.stringify({ baseUrl: 'https://api.transferegov.gov.br' }),
      ]);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/test-connection`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.status).toBe('error');
      expect(res.body.code).toBe('CONFIGURATION_ERROR');
      expect(res.body.message).toContain('credencial');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('test-connection: configuração válida chega ao fluxo de conexão (HTTP executado)', async () => {
      process.env.TRANSFEREGOV_API_KEY = 'chave-valida-123';
      await run('UPDATE integration_systems SET config = $2 WHERE id = $1', [
        transferegovId,
        JSON.stringify({ baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'TRANSFEREGOV_API_KEY' }),
      ]);
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ propostas: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      );
      vi.stubGlobal('fetch', fetchSpy);

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/test-connection`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.httpStatus).toBe(200);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('test-connection: falha de autenticação impede a requisição de dados (fetch chamado só 1x)', async () => {
      process.env.TRANSFEREGOV_API_KEY = 'chave-valida-123';
      await run('UPDATE integration_systems SET config = $2 WHERE id = $1', [
        transferegovId,
        JSON.stringify({
          baseUrl: 'https://api.transferegov.gov.br',
          secretEnvKey: 'TRANSFEREGOV_API_KEY',
          extra: { authType: 'oauth2', clientId: 'sgd-client' },
        }),
      ]);
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
      );
      vi.stubGlobal('fetch', fetchSpy);

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/test-connection`);
      expect(res.body.status).toBe('error');
      expect(res.body.message).toContain('autenticação');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('test-connection: erro não vaza segredo nem nome da variável de ambiente', async () => {
      process.env.TRANSFEREGOV_API_KEY = 'SEGREDO-NAO-DEVE-APARECER-12345';
      await run('UPDATE integration_systems SET config = $2 WHERE id = $1', [
        transferegovId,
        JSON.stringify({ baseUrl: 'url-invalida', secretEnvKey: 'TRANSFEREGOV_API_KEY' }),
      ]);

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/test-connection`);
      expect(res.body.code).toBe('CONFIGURATION_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('SEGREDO-NAO-DEVE-APARECER-12345');
      expect(JSON.stringify(res.body)).not.toContain('TRANSFEREGOV_API_KEY');

      const log = await get(
        `SELECT * FROM integration_logs WHERE system_id = $1 AND action = 'integration.test-connection' ORDER BY id DESC LIMIT 1`,
        [transferegovId]
      );
      expect(JSON.stringify(log)).not.toContain('SEGREDO-NAO-DEVE-APARECER-12345');
      expect(JSON.stringify(log)).not.toContain('TRANSFEREGOV_API_KEY');
    });

    it('runManualSync (sem payload): configuração inválida bloqueia antes de qualquer HTTP', async () => {
      await run('UPDATE integration_systems SET config = $2 WHERE id = $1', [
        transferegovId,
        JSON.stringify({ endpoint: 'https://endpoint.gov.br/ping' }),
      ]);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/sync`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.status).toBe('error');
      expect(res.body.code).toBe('CONFIGURATION_ERROR');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('runManualSync (sem payload): configuração válida continua normalmente', async () => {
      process.env.TRANSFEREGOV_API_KEY = 'chave-valida-123';
      await run('UPDATE integration_systems SET config = $2 WHERE id = $1', [
        transferegovId,
        JSON.stringify({
          baseUrl: 'https://api.transferegov.gov.br',
          secretEnvKey: 'TRANSFEREGOV_API_KEY',
          endpoint: 'https://endpoint.gov.br/ping',
        }),
      ]);
      const fetchSpy = vi.fn().mockResolvedValue(new Response('pong', { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);

      const res = await withCsrf(adminAgent, adminCsrfToken, 'post', `/api/integrations/admin/systems/${transferegovId}/sync`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('success');
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('webhook inbound continua funcionando mesmo com config de pull inválida', async () => {
      process.env.TRANSFEREGOV_WEBHOOK_SECRET = 'webhook-secret-1234567890abc';
      await run('UPDATE integration_systems SET config = $2 WHERE id = $1', [
        transferegovId,
        JSON.stringify({ baseUrl: 'https://api.transferegov.gov.br' }),
      ]);

      const body = JSON.stringify({
        event: 'demand.updated',
        demand: { proposal_number: 'PROP-WEBHOOK-FAILFAST-UNIQUE', status: 'EM_ANALISE' },
      });
      const timestamp = Date.now();
      const signature = crypto
        .createHmac('sha256', 'webhook-secret-1234567890abc')
        .update(`${timestamp}\n`)
        .update(body)
        .digest('hex');

      const res = await request(app)
        .post('/api/integrations/webhooks/transferegov')
        .set('Content-Type', 'application/json')
        .set('X-Timestamp', String(timestamp))
        .set('X-Signature', signature)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');

      const eventId = res.body.event_id as number;
      expect(typeof eventId).toBe('number');
      await run('DELETE FROM integration_logs WHERE webhook_event_id = $1', [eventId]);
      await run('DELETE FROM webhook_events WHERE id = $1', [eventId]);
    });
  });
});

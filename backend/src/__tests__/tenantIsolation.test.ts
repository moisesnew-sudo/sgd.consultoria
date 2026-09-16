import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../server.js';
import { get, run } from '../database.js';

const stamp = Date.now();
const tenantOneId = `TENANT-ONE-${stamp}`;
const tenantTwoId = `TENANT-TWO-${stamp}`;
const tenantTwoAdmin = `tenant-two-admin-${stamp}@example.test`;
const tenantTwoUser = `tenant-two-user-${stamp}@example.test`;
const tenantTwoCreateUser = `tenant-two-create-${stamp}@example.test`;
const password = 'TenantTest2026!';

const tenantOneAdmin = { email: 'admin@sgd.gov.br', password: 'Admin2026!' };

let tenantOneAgent: ReturnType<typeof request.agent>;
let tenantOneCsrf: string;
let tenantTwoAgent: ReturnType<typeof request.agent>;
let tenantTwoCsrf: string;

let tenantTwoAdminId: number;
let tenantTwoUserId: number;
let tenantTwoSessionId: number;
let tenantTwoSystemId: number;
let tenantTwoAlertId: number;
let tenantTwoMunicipalityId: number;
let tenantTwoWebhookId: number;
let tenantTwoDeliveryId: number;

function csrfFrom(response: request.Response): string {
  const cookie = (response.headers['set-cookie'] as unknown as string[] | undefined)?.find(value => value.startsWith('csrf_token='));
  const token = cookie?.match(/^csrf_token=([^;]+)/)?.[1];
  if (!token) throw new Error('CSRF token ausente');
  return token;
}

/**
 * Mutação com CSRF. O agent guarda os cookies (token + csrf_token) no jar;
 * apenas o header x-csrf-token precisa ser enviado manualmente.
 */
function withCsrf(agent: ReturnType<typeof request.agent>, csrfToken: string, method: 'post' | 'put' | 'patch' | 'delete', url: string, body?: any) {
  return agent[method](url)
    .set('x-csrf-token', csrfToken)
    .send(body ?? {});
}

async function login(email: string, tenantId: number, loginPassword = password) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/login').send({ email, password: loginPassword, tenantId });
  expect(response.status).toBe(200);
  return { agent, csrfToken: csrfFrom(response) };
}

describe('Isolamento entre tenants', () => {
  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 10);

    // Admin do tenant 2 (bypass de requirePermission via role admin)
    await run(
      `INSERT INTO users (email, password_hash, name, role, tenant_id)
       VALUES ($1, $2, 'Admin Tenant Dois', 'admin', 2)
       ON CONFLICT (tenant_id, LOWER(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, active = TRUE, deleted_at = NULL`,
      [tenantTwoAdmin, hash]
    );
    const adminRow = await get<{ id: number }>('SELECT id FROM users WHERE email = $1 AND tenant_id = 2', [tenantTwoAdmin]);
    tenantTwoAdminId = adminRow!.id;

    // Usuário comum do tenant 2 (alvo dos testes de edição cross-tenant)
    await run(
      `INSERT INTO users (email, password_hash, name, role, tenant_id)
       VALUES ($1, $2, 'Usuario Tenant Dois', 'consulta', 2)
       ON CONFLICT (tenant_id, LOWER(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, active = TRUE, deleted_at = NULL`,
      [tenantTwoUser, hash]
    );
    const userRow = await get<{ id: number }>('SELECT id FROM users WHERE email = $1 AND tenant_id = 2', [tenantTwoUser]);
    tenantTwoUserId = userRow!.id;

    // Demandas privadas: uma por tenant
    await run(
      `INSERT INTO demands (id, title, category, municipality, uf, status, priority, tenant_id)
       VALUES ($1, 'DEMANDA PRIVADA TENANT UM', 'TESTE', 'SOBRAL', 'CE', 'pendente', 'media', 1),
              ($2, 'DEMANDA PRIVADA TENANT DOIS', 'TESTE', 'SOBRAL', 'CE', 'pendente', 'media', 2)`,
      [tenantOneId, tenantTwoId]
    );

    // Versão de demanda do tenant 2 (deve ser invisível ao tenant 1)
    await run(
      `INSERT INTO demand_versions (demand_id, version, snapshot, changed_by, changed_by_name, tenant_id)
       VALUES ($1, 1, '{}', $2, 'Admin Tenant Dois', 2)`,
      [tenantTwoId, tenantTwoAdminId]
    );

    // Município do tenant 2 (o seed cria SOBRAL/CE apenas no tenant 1)
    const muni = await run(
      `INSERT INTO municipalities (name, uf, region, tenant_id)
       VALUES ($1, 'CE', 'Nordeste', 2) RETURNING id`,
      [`SOBRAL-ISO-${stamp}`]
    );
    tenantTwoMunicipalityId = muni.rows[0].id;

    // Sistema de integração do tenant 2 + alerta aberto apenas desse tenant
    const sys = await run(
      `INSERT INTO integration_systems (code, name, secret_env_key, active, tenant_id)
       VALUES ($1, 'Sistema Isolado Tenant 2', 'TEST_SECRET_2', TRUE, 2) RETURNING id`,
      [`ISO-T2-${stamp}`]
    );
    tenantTwoSystemId = sys.rows[0].id;
    const alert = await run(
      `INSERT INTO integration_alerts (system_id, severity, type, message, status, tenant_id)
       VALUES ($1, 'warning', 'sync.stalled', 'Alerta privado do tenant 2', 'open', 2) RETURNING id`,
      [tenantTwoSystemId]
    );
    tenantTwoAlertId = alert.rows[0].id;

    // Log de integração do tenant 2 (para o filtro de logs por tenant)
    await run(
      `INSERT INTO integration_logs (system_id, system_code, direction, action, tenant_id)
       VALUES ($1, 'ISO-T2', 'out', 'isolated.log', 2)`,
      [tenantTwoSystemId]
    );

    // Webhook de saída + entrega falhada do tenant 2 (para retry cross-tenant)
    const wh = await run(
      `INSERT INTO outbound_webhooks (name, url, secret_hash, events, active, tenant_id)
       VALUES ($1, 'https://exemplo.invalid/hook', $2, $3, TRUE, 2) RETURNING id`,
      [`Webhook Iso T2-${stamp}`, crypto.createHash('sha256').update('x').digest('hex'), ['demand:created']]
    );
    tenantTwoWebhookId = wh.rows[0].id;
    const dlv = await run(
      `INSERT INTO webhook_deliveries (webhook_id, tenant_id, event_type, url, request_body, attempt, status)
       VALUES ($1, 2, 'demand:created', 'https://exemplo.invalid/hook', '{}', 1, 'failed') RETURNING id`,
      [tenantTwoWebhookId]
    );
    tenantTwoDeliveryId = dlv.rows[0].id;

    // Sessões: login dos dois tenants (cada login gera active_session com tenant_id)
    const one = await login(tenantOneAdmin.email, 1, tenantOneAdmin.password);
    tenantOneAgent = one.agent;
    tenantOneCsrf = one.csrfToken;

    const two = await login(tenantTwoAdmin, 2);
    tenantTwoAgent = two.agent;
    tenantTwoCsrf = two.csrfToken;
    const session = await get<{ id: number }>(
      'SELECT id FROM active_sessions WHERE user_id = $1 AND tenant_id = 2 ORDER BY id DESC LIMIT 1',
      [tenantTwoAdminId]
    );
    tenantTwoSessionId = session!.id;
  });

  afterAll(async () => {
    if (tenantTwoDeliveryId) await run('DELETE FROM webhook_deliveries WHERE id = $1', [tenantTwoDeliveryId]);
    if (tenantTwoWebhookId) await run('DELETE FROM outbound_webhooks WHERE id = $1', [tenantTwoWebhookId]);
    if (tenantTwoAlertId) await run('DELETE FROM integration_alerts WHERE id = $1', [tenantTwoAlertId]);
    if (tenantTwoSystemId) await run('DELETE FROM integration_logs WHERE system_id = $1', [tenantTwoSystemId]);
    if (tenantTwoSystemId) await run('DELETE FROM integration_systems WHERE id = $1', [tenantTwoSystemId]);
    if (tenantTwoMunicipalityId) await run('DELETE FROM municipalities WHERE id = $1', [tenantTwoMunicipalityId]);
    await run('DELETE FROM demand_versions WHERE demand_id = $1', [tenantTwoId]);
    await run('DELETE FROM demands WHERE id = ANY($1::text[])', [[tenantOneId, tenantTwoId]]);
    await run('UPDATE users SET active = FALSE, deleted_at = NOW() WHERE email = ANY($1::text[])', [[tenantTwoAdmin, tenantTwoUser, tenantTwoCreateUser]]);
    await run('DELETE FROM active_sessions WHERE user_id = $1', [tenantTwoAdminId]);
  });

  it('1. demanda de outro tenant não aparece nem em listagens nem em detalhes', async () => {
    const list = await tenantOneAgent.get('/api/demands').query({ limit: 200 });
    expect(list.status).toBe(200);
    const ids = list.body.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(tenantOneId);
    expect(ids).not.toContain(tenantTwoId);

    const detail = await tenantOneAgent.get(`/api/demands/${tenantTwoId}`);
    expect(detail.status).toBe(404);

    const calendar = await tenantOneAgent.get('/api/demands/calendar/events');
    expect(calendar.status).toBe(200);
    expect(calendar.body.some((e: { demandId: string }) => e.demandId === tenantTwoId)).toBe(false);

    const executive = await tenantOneAgent.get('/api/demands/stats/executive');
    expect(executive.status).toBe(200);
  });

  it('2. versões de demanda de outro tenant não vazam', async () => {
    const versions = await tenantOneAgent.get(`/api/demands/${tenantTwoId}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body).toEqual([]);

    const own = await tenantOneAgent.get(`/api/demands/${tenantOneId}/versions`);
    expect(own.status).toBe(200);
  });

  it('3. município de outro tenant retorna 404', async () => {
    const cross = await tenantOneAgent.get(`/api/municipalities/${tenantTwoMunicipalityId}`);
    expect(cross.status).toBe(404);

    const own = await tenantTwoAgent.get(`/api/municipalities/${tenantTwoMunicipalityId}`);
    expect(own.status).toBe(200);
  });

  it('4. usuários de outro tenant não aparecem em listagens', async () => {
    const usersOne = await tenantOneAgent.get('/api/auth/users');
    expect(usersOne.status).toBe(200);
    expect(usersOne.body.map((u: { email: string }) => u.email)).not.toContain(tenantTwoAdmin);

    const activeOne = await tenantOneAgent.get('/api/auth/users/active');
    expect(activeOne.status).toBe(200);
    expect(activeOne.body.map((u: { email: string }) => u.email)).not.toContain(tenantTwoAdmin);

    const usersTwo = await tenantTwoAgent.get('/api/auth/users');
    expect(usersTwo.status).toBe(200);
    expect(usersTwo.body.map((u: { email: string }) => u.email)).not.toContain(tenantOneAdmin.email);
  });

  it('5. criação de usuário grava no tenant do administrador', async () => {
    const create = await withCsrf(tenantTwoAgent, tenantTwoCsrf, 'post', '/api/auth/users', {
      email: tenantTwoCreateUser,
      password,
      name: 'Usuario Criado Tenant Dois',
      role: 'consulta',
    });
    expect(create.status).toBe(201);
    const created = await get<{ tenant_id: number }>('SELECT tenant_id FROM users WHERE email = $1', [tenantTwoCreateUser]);
    expect(created?.tenant_id).toBe(2);
  });

  it('6. permissões de usuário de outro tenant retornam 404 (GET e PUT)', async () => {
    const getCross = await tenantOneAgent.get(`/api/permissions/user/${tenantTwoAdminId}`);
    expect(getCross.status).toBe(404);

    const putCross = await withCsrf(tenantOneAgent, tenantOneCsrf, 'put', `/api/permissions/user/${tenantTwoAdminId}`, { permissions: [] });
    expect(putCross.status).toBe(404);

    const getOwn = await tenantTwoAgent.get(`/api/permissions/user/${tenantTwoAdminId}`);
    expect(getOwn.status).toBe(200);
  });

  it('7. sessões de outro tenant não aparecem e não podem ser encerradas', async () => {
    const sessionsOne = await tenantOneAgent.get('/api/sessions');
    expect(sessionsOne.status).toBe(200);
    expect(sessionsOne.body.map((s: { user_id: number }) => s.user_id)).not.toContain(tenantTwoAdminId);

    const delCross = await withCsrf(tenantOneAgent, tenantOneCsrf, 'delete', `/api/sessions/${tenantTwoSessionId}`);
    expect(delCross.status).toBe(404);

    const sessionsTwo = await tenantTwoAgent.get('/api/sessions');
    expect(sessionsTwo.status).toBe(200);
    expect(sessionsTwo.body.map((s: { user_id: number }) => s.user_id)).toContain(tenantTwoAdminId);
  });

  it('8. monitoramento de saúde considera apenas o tenant autenticado', async () => {
    const healthOne = await tenantOneAgent.get('/api/monitoring/health');
    expect(healthOne.status).toBe(200);

    const sysHealthOne = await tenantOneAgent.get('/api/monitoring/system-health');
    expect(sysHealthOne.status).toBe(200);
    const alertIdsOne = (sysHealthOne.body.alerts?.items ?? []).map((a: { id: number }) => a.id);
    expect(alertIdsOne).not.toContain(tenantTwoAlertId);

    const sysHealthTwo = await tenantTwoAgent.get('/api/monitoring/system-health');
    expect(sysHealthTwo.status).toBe(200);
    const alertIdsTwo = (sysHealthTwo.body.alerts?.items ?? []).map((a: { id: number }) => a.id);
    expect(alertIdsTwo).toContain(tenantTwoAlertId);
  });

  it('9. integrações admin (overview/detail) não expõem dados de outro tenant', async () => {
    const overviewOne = await tenantOneAgent.get('/api/integrations/admin/overview');
    expect(overviewOne.status).toBe(200);
    expect(overviewOne.body.systems.map((s: { code: string }) => s.code)).not.toContain(`ISO-T2-${stamp}`);

    const overviewTwo = await tenantTwoAgent.get('/api/integrations/admin/overview');
    expect(overviewTwo.status).toBe(200);
    expect(overviewTwo.body.systems.map((s: { code: string }) => s.code)).toContain(`ISO-T2-${stamp}`);

    const detailCross = await tenantOneAgent.get(`/api/integrations/admin/systems/${tenantTwoSystemId}`);
    expect(detailCross.status).toBe(404);

    const listOne = await tenantOneAgent.get('/api/integrations/systems');
    expect(listOne.status).toBe(200);
    const codesOne = (listOne.body.systems ?? listOne.body.data ?? listOne.body).map((s: { code: string }) => s.code);
    expect(codesOne).not.toContain(`ISO-T2-${stamp}`);
  });

  it('10. webhooks de saída e retry de entrega não cruzam tenants', async () => {
    const listOne = await tenantOneAgent.get('/api/admin/outbound-webhooks');
    expect(listOne.status).toBe(200);
    expect(listOne.body.webhooks.map((w: { name: string }) => w.name)).not.toContain(`Webhook Iso T2-${stamp}`);

    const listTwo = await tenantTwoAgent.get('/api/admin/outbound-webhooks');
    const namesTwo = (listTwo.body.webhooks ?? []).map((w: { name: string }) => w.name);
    expect(namesTwo).toContain(`Webhook Iso T2-${stamp}`);

    const retryCross = await withCsrf(tenantOneAgent, tenantOneCsrf, 'post', `/api/admin/outbound-webhooks/deliveries/${tenantTwoDeliveryId}/retry`);
    expect(retryCross.status).toBe(404);

    const deliveriesOne = await tenantOneAgent.get('/api/admin/outbound-webhooks/deliveries');
    expect(deliveriesOne.status).toBe(200);
  });

  it('11. export JSON de backups considera apenas o tenant autenticado', async () => {
    const exportOne = await tenantOneAgent.get('/api/settings/export');
    expect(exportOne.status).toBe(200);
    const demandIdsOne = exportOne.body.data.demands.map((d: { id: string }) => d.id);
    expect(demandIdsOne).toContain(tenantOneId);
    expect(demandIdsOne).not.toContain(tenantTwoId);

    const exportTwo = await tenantTwoAgent.get('/api/settings/export');
    expect(exportTwo.status).toBe(200);
    const demandIdsTwo = exportTwo.body.data.demands.map((d: { id: string }) => d.id);
    expect(demandIdsTwo).not.toContain(tenantOneId);
  });

  it('12. painéis de auditoria e LGPD contam apenas o tenant autenticado', async () => {
    const auditOne = await tenantOneAgent.get('/api/audit/dashboard-stats');
    expect(auditOne.status).toBe(200);

    const lgpdOne = await tenantOneAgent.get('/api/lgpd/dashboard');
    expect(lgpdOne.status).toBe(200);

    const lgpdTwo = await tenantTwoAgent.get('/api/lgpd/dashboard');
    expect(lgpdTwo.status).toBe(200);

    const oneCount = await get<{ count: string }>('SELECT COUNT(*) as count FROM users WHERE tenant_id = 1 AND deleted_at IS NULL');
    expect(lgpdOne.body.users.total).toBe(parseInt(oneCount?.count || '0'));

    const twoCount = await get<{ count: string }>('SELECT COUNT(*) as count FROM users WHERE tenant_id = 2 AND deleted_at IS NULL');
    expect(lgpdTwo.body.users.total).toBe(parseInt(twoCount?.count || '0'));
  });

  it('13. usuário de outro tenant não pode ser editado pelo admin do tenant errado', async () => {
    const editCross = await withCsrf(tenantOneAgent, tenantOneCsrf, 'put', `/api/auth/users/${tenantTwoUserId}`, { name: 'Invasao' });
    expect(editCross.status).toBe(404);

    const editOwn = await withCsrf(tenantTwoAgent, tenantTwoCsrf, 'put', `/api/auth/users/${tenantTwoUserId}`, { name: 'Usuario Tenant Dois Renomeado' });
    expect(editOwn.status).toBe(200);
    await run('UPDATE users SET name = $1 WHERE id = $2', ['Usuario Tenant Dois', tenantTwoUserId]);
  });

  it('14. usuários de outro tenant não aparecem no log de auditoria do tenant 1', async () => {
    const auditListOne = await tenantOneAgent.get('/api/audit');
    expect(auditListOne.status).toBe(200);
    const rows = auditListOne.body ?? {};
    const items = Array.isArray(rows) ? rows : (rows.items ?? rows.logs ?? rows.data ?? []);
    const userIds = items.map((r: { user_id?: number }) => r.user_id);
    expect(userIds).not.toContain(tenantTwoAdminId);
  });
});
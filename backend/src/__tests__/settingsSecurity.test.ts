import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../server.js';
import { get, run, initDatabase } from '../database.js';

const stamp = Date.now();
const password = 'C1A1A2Test2026!';

const t2Admin = `t2-admin-${stamp}@example.test`;
const t2User = `t2-user-${stamp}@example.test`;
const t3Admin = `t3-admin-${stamp}@example.test`;

const demandT1 = `C1A1A2-DEMAND-T1-${stamp}`;
const demandT2 = `C1A1A2-DEMAND-T2-${stamp}`;
const demandT3 = `C1A1A2-DEMAND-T3-${stamp}`;
const demandT3Imported = `C1A1A2-DEMAND-T3-IMPORTED-${stamp}`;
const muniT3Imported = `C1A1A2-MUNI-T3-IMPORTED-${stamp}`;

let t3AdminId: number;

let agentT1: ReturnType<typeof request.agent>;
let csrfT1 = '';
let agentT2: ReturnType<typeof request.agent>;
let csrfT2 = '';
let agentT3: ReturnType<typeof request.agent>;
let csrfT3 = '';

function csrfFrom(response: request.Response): string {
  const cookie = (response.headers['set-cookie'] as unknown as string[] | undefined)?.find(value => value.startsWith('csrf_token='));
  const token = cookie?.match(/^csrf_token=([^;]+)/)?.[1];
  if (!token) throw new Error('CSRF token ausente');
  return token;
}

function withCsrf(agent: ReturnType<typeof request.agent>, csrfToken: string, method: 'post' | 'put', url: string, body?: any) {
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

function makeImportPayload(extra: Record<string, unknown> = {}) {
  return {
    version: 'sgd-v2',
    timestamp: new Date().toISOString(),
    data: {
      demands: [],
      municipalities: [],
      ...extra,
    },
  };
}

describe('Correções C1/A1/A2 — settings por tenant, import RBAC bloqueado, log-export contido', () => {
  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 10);

    await run(
      `INSERT INTO users (email, password_hash, name, role, tenant_id)
       VALUES ($1, $2, 'Admin Tenant Dois', 'admin', 2)
       ON CONFLICT (tenant_id, LOWER(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, active = TRUE, deleted_at = NULL`,
      [t2Admin, hash]
    );
    await run(
      `INSERT INTO users (email, password_hash, name, role, tenant_id)
       VALUES ($1, $2, 'Usuario Tenant Dois', 'consulta', 2)
       ON CONFLICT (tenant_id, LOWER(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, active = TRUE, deleted_at = NULL`,
      [t2User, hash]
    );
    await run(
      `INSERT INTO users (email, password_hash, name, role, tenant_id)
       VALUES ($1, $2, 'Admin Tenant Tres', 'admin', 3)
       ON CONFLICT (tenant_id, LOWER(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, active = TRUE, deleted_at = NULL`,
      [t3Admin, hash]
    );
    const adminRow = await get<{ id: number }>('SELECT id FROM users WHERE email = $1 AND tenant_id = 3', [t3Admin]);
    t3AdminId = adminRow!.id;

    await run(
      `INSERT INTO demands (id, title, category, municipality, uf, status, priority, tenant_id)
       VALUES ($1, 'DEMANDA T1', 'TESTE', 'SOBRAL', 'CE', 'pendente', 'media', 1),
              ($2, 'DEMANDA T2', 'TESTE', 'SOBRAL', 'CE', 'pendente', 'media', 2),
              ($3, 'DEMANDA T3', 'TESTE', 'SOBRAL', 'CE', 'pendente', 'media', 3)`,
      [demandT1, demandT2, demandT3]
    );

    const one = await login('admin@sgd.gov.br', 1, 'Admin2026!');
    agentT1 = one.agent;
    csrfT1 = one.csrfToken;
    const two = await login(t2Admin, 2);
    agentT2 = two.agent;
    csrfT2 = two.csrfToken;
    const three = await login(t3Admin, 3);
    agentT3 = three.agent;
    csrfT3 = three.csrfToken;
  });

  afterAll(async () => {
    await run('DELETE FROM demands WHERE id = ANY($1::text[])', [[demandT1, demandT2, demandT3, demandT3Imported]]);
    await run('DELETE FROM municipalities WHERE name = $1', [muniT3Imported]);
    await run('DELETE FROM system_settings WHERE tenant_id IN (2, 3, 4242)');
    await run('UPDATE users SET active = FALSE, deleted_at = NOW() WHERE email = ANY($1::text[])', [[t2Admin, t2User, t3Admin, `legacy-admin-${stamp}@example.test`]]);
  });

  it('A1: GET /api/settings retorna apenas o row do próprio tenant', async () => {
    const one = await agentT1.get('/api/settings');
    expect(one.status).toBe(200);
    expect(one.body.tenant_id).toBe(1);
    expect(one.body.sla_days_alta).toBe(15);

    const two = await agentT2.get('/api/settings');
    expect(two.status).toBe(200);
    expect(two.body.tenant_id).toBe(2);

    const rows = await run('SELECT COUNT(*)::int AS count FROM system_settings');
    expect(rows.rows[0].count).toBeGreaterThanOrEqual(2);
  });

  it('A1: PUT de admin altera somente o próprio tenant (sem efeito no tenant 1)', async () => {
    await withCsrf(agentT2, csrfT2, 'put', '/api/settings', { sla_days_alta: 7 }).expect(200);

    const t1 = await get<{ sla_days_alta: number }>('SELECT sla_days_alta FROM system_settings WHERE tenant_id = 1');
    const t2 = await get<{ sla_days_alta: number }>('SELECT sla_days_alta FROM system_settings WHERE tenant_id = 2');
    expect(t1!.sla_days_alta).toBe(15);
    expect(t2!.sla_days_alta).toBe(7);
  });

  it('A1: tenant_id enviado no corpo do PUT é ignorado (operação sempre no tenant autenticado)', async () => {
    await withCsrf(agentT2, csrfT2, 'put', '/api/settings', { sla_days_baixa: 20, tenant_id: 1 }).expect(200);

    const t1 = await get<{ sla_days_baixa: number }>('SELECT sla_days_baixa FROM system_settings WHERE tenant_id = 1');
    const t2 = await get<{ sla_days_baixa: number }>('SELECT sla_days_baixa FROM system_settings WHERE tenant_id = 2');
    expect(t1!.sla_days_baixa).toBe(45);
    expect(t2!.sla_days_baixa).toBe(20);
  });

  it('A1: usuário comum de outro tenant não pode modificar configuration global', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email: t2User, password, tenantId: 2 });
    expect(res.status).toBe(200);
    const csrf = csrfFrom(res);
    const put = await agent
      .put('/api/settings')
      .set('x-csrf-token', csrf)
      .send({ sla_days_alta: 1 });
    expect(put.status).toBe(403);
  });

  it('A1: export de settings considera apenas o tenant autenticado', async () => {
    const one = await agentT1.get('/api/settings/export');
    expect(one.status).toBe(200);
    expect(one.body.data.settings?.tenant_id).toBe(1);

    const two = await agentT2.get('/api/settings/export');
    expect(two.status).toBe(200);
    expect(two.body.data.settings?.tenant_id).toBe(2);
  });

  it('C1: import rejeita payload com permissions (estrutura global de RBAC)', async () => {
    const before = await run('SELECT COUNT(*)::int AS count FROM permissions');
    const res = await withCsrf(agentT3, csrfT3, 'post', '/api/settings/import', makeImportPayload({
      permissions: [{ key: 'x', name: 'X', category: 'x' }],
    }));
    expect(res.status).toBe(403);
    const after = await run('SELECT COUNT(*)::int AS count FROM permissions');
    expect(after.rows[0].count).toBe(before.rows[0].count);

    const stillThere = await get('SELECT id FROM demands WHERE id = $1', [demandT3]);
    expect(stillThere).toBeDefined();
  });

  it('C1: import rejeita payload com user_permissions', async () => {
    const before = await run('SELECT COUNT(*)::int AS count FROM user_permissions');
    const res = await withCsrf(agentT3, csrfT3, 'post', '/api/settings/import', makeImportPayload({
      user_permissions: [{ user_id: t3AdminId, permission_id: 1, granted: true }],
    }));
    expect(res.status).toBe(403);
    const after = await run('SELECT COUNT(*)::int AS count FROM user_permissions');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('C1: import rejeita payload com role_permissions', async () => {
    const before = await run('SELECT COUNT(*)::int AS count FROM role_permissions');
    const res = await withCsrf(agentT3, csrfT3, 'post', '/api/settings/import', makeImportPayload({
      role_permissions: [{ role: 'admin', permission_id: 1 }],
    }));
    expect(res.status).toBe(403);
    const after = await run('SELECT COUNT(*)::int AS count FROM role_permissions');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('C1: import em lote com RBAC misturado também é rejeitado sem alteração parcial', async () => {
    const res = await withCsrf(agentT3, csrfT3, 'post', '/api/settings/import', makeImportPayload({
      demands: [{ id: demandT3Imported, title: 'DEMANDA T3 BLOQUEADA', category: 'TESTE', municipality: 'SOBRAL', uf: 'CE' }],
      municipalities: [{ name: muniT3Imported, uf: 'CE', region: 'Nordeste' }],
      role_permissions: [{ role: 'gestor', permission_id: 2 }],
    }));
    expect(res.status).toBe(403);

    const demand = await get('SELECT id FROM demands WHERE id = $1', [demandT3Imported]);
    expect(demand).toBeUndefined();
    const muni = await get('SELECT id FROM municipalities WHERE name = $1', [muniT3Imported]);
    expect(muni).toBeUndefined();
  });

  it('C1: import legítimo tenant-scoped (demands/municipalities/settings objeto) continua funcionando', async () => {
    const payload = makeImportPayload({
      demands: [{ id: demandT3Imported, title: 'DEMANDA IMPORTADA T3', category: 'TESTE', municipality: 'SOBRAL', uf: 'CE', status: 'pendente', priority: 'media' }],
      municipalities: [{ name: muniT3Imported, uf: 'CE', region: 'Nordeste' }],
      settings: { sla_days_alta: 5, sla_days_baixa: 60, auto_triage: false },
    });
    const res = await withCsrf(agentT3, csrfT3, 'post', '/api/settings/import', payload);
    expect(res.status).toBe(200);

    const demand = await get<{ tenant_id: number }>('SELECT tenant_id FROM demands WHERE id = $1', [demandT3Imported]);
    expect(demand?.tenant_id).toBe(3);

    const muni = await get<{ tenant_id: number }>('SELECT tenant_id FROM municipalities WHERE name = $1', [muniT3Imported]);
    expect(muni?.tenant_id).toBe(3);

    const settings = await get<{ sla_days_alta: number; sla_days_baixa: number; auto_triage: boolean }>(
      'SELECT sla_days_alta, sla_days_baixa, auto_triage FROM system_settings WHERE tenant_id = 3'
    );
    expect(settings?.sla_days_alta).toBe(5);
    expect(settings?.sla_days_baixa).toBe(60);
    expect(settings?.auto_triage).toBe(false);

    const t1Settings = await get<{ sla_days_alta: number }>('SELECT sla_days_alta FROM system_settings WHERE tenant_id = 1');
    expect(t1Settings?.sla_days_alta).toBe(15);
  });

  it('A2: log-export com demand de outro tenant é rejeitado (403) sem escrever timeline', async () => {
    const res = await withCsrf(agentT1, csrfT1, 'post', '/api/audit/log-export', {
      export_type: 'excel',
      record_count: 3,
      demand_ids: [demandT2],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).not.toContain(demandT2);

    const timeline = await run('SELECT COUNT(*)::int AS count FROM timeline_events WHERE demand_id = $1', [demandT2]);
    expect(timeline.rows[0].count).toBe(0);
  });

  it('A2: log-export misto (própria + estrangeira) é rejeitado como um todo', async () => {
    const res = await withCsrf(agentT1, csrfT1, 'post', '/api/audit/log-export', {
      export_type: 'csv',
      record_count: 5,
      demand_ids: [demandT1, demandT2],
    });
    expect(res.status).toBe(403);

    const t1Timeline = await run('SELECT COUNT(*)::int AS count FROM timeline_events WHERE demand_id = $1', [demandT1]);
    const t2Timeline = await run('SELECT COUNT(*)::int AS count FROM timeline_events WHERE demand_id = $1', [demandT2]);
    expect(t1Timeline.rows[0].count).toBe(0);
    expect(t2Timeline.rows[0].count).toBe(0);
  });

  it('A2: log-export legítimo com demanda do próprio tenant continua funcionando', async () => {
    const res = await withCsrf(agentT1, csrfT1, 'post', '/api/audit/log-export', {
      export_type: 'pdf',
      record_count: 2,
      demand_ids: [demandT1],
    });
    expect(res.status).toBe(200);

    const t1Timeline = await run('SELECT COUNT(*)::int AS count FROM timeline_events WHERE demand_id = $1', [demandT1]);
    expect(t1Timeline.rows[0].count).toBe(1);
    const event = await get<{ tenant_id: number }>(
      'SELECT tenant_id FROM timeline_events WHERE demand_id = $1 ORDER BY created_at DESC LIMIT 1',
      [demandT1]
    );
    expect(event?.tenant_id).toBe(1);

    const t2Timeline = await run('SELECT COUNT(*)::int AS count FROM timeline_events WHERE demand_id = $1', [demandT2]);
    expect(t2Timeline.rows[0].count).toBe(0);
  });

  it('A2: log-export legítimo sem demand_ids continua funcionando', async () => {
    const res = await withCsrf(agentT1, csrfT1, 'post', '/api/audit/log-export', {
      export_type: 'csv',
      record_count: 10,
      filters: { status: 'pendente' },
    });
    expect(res.status).toBe(200);
  });

  it('A1-hardening: schema final de system_settings (PK em tenant_id, NOT NULL, sem coluna id, sem indices redundantes)', async () => {
    const nullable = await get<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'system_settings' AND column_name = 'tenant_id'`
    );
    expect(nullable?.is_nullable).toBe('NO');

    const pkCols = await run(
      `SELECT a.attname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'system_settings'::regclass AND c.contype = 'p' ORDER BY a.attname`
    );
    expect(pkCols.rows.map((r: { attname: string }) => r.attname)).toEqual(['tenant_id']);

    const idCol = await get(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'system_settings' AND column_name = 'id'`
    );
    expect(idCol).toBeUndefined();

    const redundant = await run(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'system_settings'
        AND indexname IN ('uq_system_settings_tenant', 'idx_system_settings_tenant')`
    );
    expect(redundant.rows).toEqual([]);
  });

  it('A1-hardening: initDatabase e idempotente e preserva isolamento entre tenant 1 e tenant 2', async () => {
    await initDatabase();
    await initDatabase();

    const one = await agentT1.get('/api/settings');
    expect(one.status).toBe(200);
    expect(one.body.tenant_id).toBe(1);

    const t1 = await get<{ tenant_id: number }>('SELECT tenant_id FROM system_settings WHERE tenant_id = 1');
    const t2 = await get<{ tenant_id: number }>('SELECT tenant_id FROM system_settings WHERE tenant_id = 2');
    expect(t1?.tenant_id).toBe(1);
    expect(t2?.tenant_id).toBe(2);
  });

  it('Backup legado: settings.id e ignorado e tenant_id do backup nao tem autoridade (outro tenant intacto)', async () => {
    // Tenant fresco (4242): sem export_logs/auditoria apontando para o usuario,
    // isolado de fixtures dos tenants 1/2/3 e de outros arquivos de teste.
    const legacyAdmin = `legacy-admin-${stamp}@example.test`;
    const legacyHash = await bcrypt.hash(password, 10);
    await run(
      `INSERT INTO users (email, password_hash, name, role, tenant_id)
       VALUES ($1, $2, 'Legacy Admin', 'admin', 4242)
       ON CONFLICT (tenant_id, LOWER(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, active = TRUE, deleted_at = NULL`,
      [legacyAdmin, legacyHash]
    );
    const legacy = await login(legacyAdmin, 4242);
    const payload = makeImportPayload({
      settings: { id: 1, tenant_id: 999, sla_days_alta: 9, sla_days_baixa: 61, auto_triage: false },
    });
    const res = await withCsrf(legacy.agent, legacy.csrfToken, 'post', '/api/settings/import', payload);
    expect(res.status).toBe(200);

    const t4 = await get<{ tenant_id: number; sla_days_alta: number; sla_days_baixa: number; auto_triage: boolean }>(
      'SELECT tenant_id, sla_days_alta, sla_days_baixa, auto_triage FROM system_settings WHERE tenant_id = 4242'
    );
    expect(t4?.tenant_id).toBe(4242);
    expect(t4?.sla_days_alta).toBe(9);
    expect(t4?.sla_days_baixa).toBe(61);
    expect(t4?.auto_triage).toBe(false);

    const t1 = await get<{ sla_days_alta: number; sla_days_baixa: number }>(
      'SELECT sla_days_alta, sla_days_baixa FROM system_settings WHERE tenant_id = 1'
    );
    expect(t1?.sla_days_alta).toBe(15);
    expect(t1?.sla_days_baixa).toBe(45);

    const alien = await get('SELECT tenant_id FROM system_settings WHERE tenant_id = 999');
    expect(alien).toBeUndefined();
  });
});
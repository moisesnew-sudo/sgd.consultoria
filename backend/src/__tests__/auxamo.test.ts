import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { get, run, all, initDatabase } from '../database.js';
import {
  GOVERNMENT_INTEGRATIONS,
  hasOrganizationCapability,
  getOrganizationCapabilities,
} from '../lib/organizationCapabilities.js';
import { getOrganizationById, getOrganizationBySlug } from '../lib/organizations.js';
import { runScheduledSyncCycle } from '../lib/integrationScheduler.js';

// ETAPA 5 (AUXAMO): organizacao permanente id=2. Nenhum usuario real, nenhuma
// integracao, nenhuma demanda e creada aqui — apenas verificacao do
// provisionamento pelo bootstrap. Fixtures transitorias (prefixo AUX5-) sao
// removidas em afterAll.
const stamp = Date.now();
const D1 = `AUX5-T1-${stamp}`;
const D2 = `AUX5-T2-${stamp}`;
const UEMAIL = `aux5-user-${stamp}@example.invalid`;

describe('AUXAMO — organizacao permanente id=2', () => {
  beforeAll(async () => {
    await initDatabase();
    // Estado conhecido para os cenarios deste arquivo: AUXAMO gov=FALSE.
    // (Protege contra resquicio de run interrompida do tenantIsolation, que
    // transpoe a capability para TRUE e a restaura no afterAll. O comportamento
    // do bootstrap em si e provado pelo auxamoFresh.test.ts em banco scratch.)
    await run(
      `UPDATE organization_capabilities SET enabled = FALSE, updated_at = NOW()
       WHERE organization_id = 2 AND capability = 'government_integrations'`
    );
  });

  afterAll(async () => {
    await run('DELETE FROM attachments WHERE demand_id = ANY($1::text[])', [[D1, D2]]);
    await run('DELETE FROM demands WHERE id = ANY($1::text[])', [[D1, D2]]);
    await run('DELETE FROM users WHERE email = $1', [UEMAIL]);
  });

  it('1. organization id=2 existe', async () => {
    const org = await getOrganizationById(2);
    expect(org).toBeDefined();
    expect(org!.id).toBe(2);
  });

  it('2. slug=auxamo', async () => {
    const org = await getOrganizationBySlug('auxamo');
    expect(org?.id).toBe(2);
    expect((await getOrganizationById(2))?.slug).toBe('auxamo');
  });

  it('3. status=active', async () => {
    expect((await getOrganizationById(2))?.status).toBe('active');
  });

  it('4. primary_domain=NULL (sem dominio inventado; resolver nao a alcanca)', async () => {
    expect((await getOrganizationById(2))?.primary_domain).toBeNull();
  });

  it('5. government_integrations=false para AUXAMO', async () => {
    expect(await hasOrganizationCapability(2, GOVERNMENT_INTEGRATIONS)).toBe(false);
    expect((await getOrganizationCapabilities(2))[GOVERNMENT_INTEGRATIONS]).toBe(false);
  });

  it('6. org 1 continua government_integrations=true', async () => {
    expect(await hasOrganizationCapability(1, GOVERNMENT_INTEGRATIONS)).toBe(true);
  });

  it('7. tenant 2 nao possui integration_systems', async () => {
    const rows = await all<{ id: number }>(
      `SELECT id FROM integration_systems WHERE tenant_id = 2`
    );
    expect(rows.length).toBe(0);
  });

  it('8. tenant 2 nao enxerga dados do tenant 1 e vice-versa', async () => {
    await run(
      `INSERT INTO demands (id, title, category, municipality, uf, status, priority, tenant_id)
       VALUES ($1, 'AUX5 PRIVADA T1', 'TESTE', 'SOBRAL', 'CE', 'pendente', 'media', 1),
              ($2, 'AUX5 PRIVADA T2', 'TESTE', 'SOBRAL', 'CE', 'pendente', 'media', 2)`,
      [D1, D2]
    );
    const seenByT2 = await all<{ id: string }>(
      `SELECT id FROM demands WHERE tenant_id = 2 AND deleted_at IS NULL`
    );
    expect(seenByT2.map((d) => d.id)).toContain(D2);
    expect(seenByT2.map((d) => d.id)).not.toContain(D1);
    const seenByT1 = await all<{ id: string }>(
      `SELECT id FROM demands WHERE tenant_id = 1 AND id = ANY($1::text[])`,
      [[D1, D2]]
    );
    expect(seenByT1.map((d) => d.id)).toEqual([D1]);
  });

  it('10. mesmo e-mail pode existir nos dois tenants (unicidade por tenant)', async () => {
    const hash = await bcrypt.hash('Aux5Test2026!', 10);
    await run(
      `INSERT INTO users (email, password_hash, name, role, tenant_id)
       VALUES ($1, $2, 'Aux5 Um', 'consulta', 1)`,
      [UEMAIL, hash]
    );
    await run(
      `INSERT INTO users (email, password_hash, name, role, tenant_id)
       VALUES ($1, $2, 'Aux5 Dois', 'consulta', 2)`,
      [UEMAIL, hash]
    );
    const rows = await all<{ tenant_id: number }>(
      `SELECT tenant_id FROM users WHERE email = $1 ORDER BY tenant_id`,
      [UEMAIL]
    );
    expect(rows.map((r) => r.tenant_id)).toEqual([1, 2]);
  });

  it('11. settings dos tenants 1 e 2 sao independentes', async () => {
    const before = await get<{ budget_cap: string }>(
      `SELECT budget_cap FROM system_settings WHERE tenant_id = 1`
    );
    await run(`UPDATE system_settings SET budget_cap = 1 WHERE tenant_id = 2`);
    try {
      const t2 = await get<{ budget_cap: string }>(
        `SELECT budget_cap FROM system_settings WHERE tenant_id = 2`
      );
      const t1 = await get<{ budget_cap: string }>(
        `SELECT budget_cap FROM system_settings WHERE tenant_id = 1`
      );
      expect(String(t2?.budget_cap)).toBe('1');
      expect(String(t1?.budget_cap)).toBe(String(before?.budget_cap));
    } finally {
      await run(`UPDATE system_settings SET budget_cap = 15000000 WHERE tenant_id = 2`);
    }
  });

  it('12. capability do tenant 1 nao vaza para o tenant 2', async () => {
    expect(await hasOrganizationCapability(1, GOVERNMENT_INTEGRATIONS)).toBe(true);
    expect(await hasOrganizationCapability(2, GOVERNMENT_INTEGRATIONS)).toBe(false);
  });

  it('13. bootstrap repetido nao duplica AUXAMO', async () => {
    await initDatabase();
    await initDatabase();
    const orgs = await all<{ id: number }>(`SELECT id FROM organizations WHERE id = 2`);
    expect(orgs.length).toBe(1);
    const caps = await all<{ enabled: boolean }>(
      `SELECT enabled FROM organization_capabilities WHERE organization_id = 2 AND capability = $1`,
      [GOVERNMENT_INTEGRATIONS]
    );
    expect(caps.length).toBe(1);
    const settings = await all<{ tenant_id: number }>(
      `SELECT tenant_id FROM system_settings WHERE tenant_id = 2`
    );
    expect(settings.length).toBe(1);
  });

  it('14. bootstrap repetido nao reativa capability deliberadamente desativada', async () => {
    // Estado atual ja e false por provisionamento; reforca e reboota.
    await run(
      `UPDATE organization_capabilities SET enabled = FALSE, updated_at = NOW()
       WHERE organization_id = 2 AND capability = $1`,
      [GOVERNMENT_INTEGRATIONS]
    );
    await initDatabase();
    expect(await hasOrganizationCapability(2, GOVERNMENT_INTEGRATIONS)).toBe(false);
  });

  it('15. dados alterados deliberadamente em AUXAMO nao sao sobrescritos por reboot', async () => {
    await run(`UPDATE organizations SET name = 'Auxamo Custom' WHERE id = 2`);
    try {
      await initDatabase();
      expect((await getOrganizationById(2))?.name).toBe('Auxamo Custom');
      expect((await getOrganizationById(2))?.slug).toBe('auxamo');
    } finally {
      await run(`UPDATE organizations SET name = 'AUXAMO' WHERE id = 2`);
    }
    expect((await getOrganizationById(2))?.name).toBe('AUXAMO');
  });

  it('sequence: proximo organization automatico recebe id > 2', async () => {
    const max = await get<{ max: string }>(`SELECT MAX(id) AS max FROM organizations`);
    expect(parseInt(max?.max || '0', 10)).toBeGreaterThanOrEqual(2);
    const row = await run(
      `INSERT INTO organizations (name, slug, status) VALUES ('Aux Seq', $1, 'active') RETURNING id`,
      [`aux-seq-${stamp}`]
    );
    try {
      expect(row.rows[0].id).toBeGreaterThan(2);
    } finally {
      await run(`DELETE FROM organizations WHERE slug = $1`, [`aux-seq-${stamp}`]);
    }
  });

  it('scheduler: tenant 2 sem capability nao gera sync, logs ou chamadas', async () => {
    await runScheduledSyncCycle();
    const logs = await all<{ id: number }>(
      `SELECT id FROM integration_logs WHERE tenant_id = 2`
    );
    expect(logs.length).toBe(0);
    const systems = await all<{ id: number }>(
      `SELECT id FROM integration_systems WHERE tenant_id = 2`
    );
    expect(systems.length).toBe(0);
  });
});

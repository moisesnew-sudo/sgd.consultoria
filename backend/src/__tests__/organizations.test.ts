import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, run, all, initDatabase } from '../database.js';
import {
  getOrganizationById,
  getOrganizationBySlug,
  getOrganizationByDomain,
  isValidSlug,
  normalizeSlug,
  normalizeDomain,
} from '../lib/organizations.js';

// Fundacao multi-tenant (ETAPA 2 AUXAMO): entidade organizations + unicidade
// por tenant em integration_systems. Fixtures usam stamp unico e sao removidas
// em afterAll; nenhum tenant real e criado (org 2/AUXAMO continua inexistente).
const stamp = Date.now();
const STAMP_CODE = `aux2-${stamp}`;
const STAMP_SLUG_A = `aux2-${stamp}`;
const STAMP_SLUG_B = `aux3-${stamp}`;
const STAMP_DOMAIN = `aux2-${stamp}.example.invalid`;

async function orgBySlug(slug: string) {
  return get<{ id: number }>('SELECT id FROM organizations WHERE slug = $1', [slug]);
}

describe('Organizations — fundacao multi-tenant', () => {
  beforeAll(async () => {
    // Garante bootstrap mesmo se este arquivo rodar primeiro (idempotente).
    await initDatabase();
  });

  afterAll(async () => {
    await run('DELETE FROM integration_systems WHERE code = $1', [STAMP_CODE]);
    await run('DELETE FROM organizations WHERE slug = ANY($1::text[])', [[STAMP_SLUG_A, STAMP_SLUG_B]]);
  });

  it('1. organization id=1 (SGD) criada corretamente no bootstrap', async () => {
    const org = await getOrganizationById(1);
    expect(org).toBeDefined();
    expect(org!.id).toBe(1);
    expect(org!.slug).toBe('sgd');
    expect(org!.name).toBe('SGD Consultoria');
    expect(org!.status).toBe('active');
    expect(org!.primary_domain).toBeNull();
  });

  it('2. migration idempotente: boots repetidos nao duplicam nem alteram a org 1', async () => {
    await initDatabase();
    await initDatabase();
    const rows = await all<{ id: number }>('SELECT id FROM organizations WHERE id = 1');
    expect(rows.length).toBe(1);
    const org = await getOrganizationById(1);
    expect(org!.slug).toBe('sgd');
    expect(org!.name).toBe('SGD Consultoria');
    expect(org!.status).toBe('active');
    const idx = await get<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'organizations' AND indexname = 'uq_organizations_domain_lower'`
    );
    expect(idx?.indexname).toBe('uq_organizations_domain_lower');
  });

  it('3. slug unico: segunda organizacao com slug existente e rejeitada', async () => {
    await expect(
      run(`INSERT INTO organizations (name, slug, status) VALUES ('Duplicada', 'sgd', 'active')`)
    ).rejects.toThrow();
  });

  it('4. dominio unico (case-insensitive): segunda org com mesmo dominio e rejeitada', async () => {
    const a = await run(
      `INSERT INTO organizations (name, slug, primary_domain, status)
       VALUES ('Org A', $1, $2, 'active') RETURNING id`,
      [STAMP_SLUG_A, STAMP_DOMAIN]
    );
    expect(a.rows[0].id).toBeDefined();
    await expect(
      run(
        `INSERT INTO organizations (name, slug, primary_domain, status)
         VALUES ('Org B', $1, $2, 'active')`,
        [STAMP_SLUG_B, STAMP_DOMAIN.toUpperCase()]
      )
    ).rejects.toThrow();
  });

  it('5. dominio pode ser NULL (multiplos NULLs permitidos)', async () => {
    const org1 = await getOrganizationById(1);
    expect(org1!.primary_domain).toBeNull();
    const b = await run(
      `INSERT INTO organizations (name, slug, primary_domain, status)
       VALUES ('Org Null', $1, NULL, 'active') RETURNING id`,
      [STAMP_SLUG_B]
    );
    expect(b.rows[0].id).toBeDefined();
  });

  it('6. dois tenants podem possuir integration_systems com o mesmo code', async () => {
    const r1 = await run(
      `INSERT INTO integration_systems (code, name, secret_env_key, tenant_id)
       VALUES ($1, 'Aux T1', 'TEST_AUX_1', 1) RETURNING id`,
      [STAMP_CODE]
    );
    const r2 = await run(
      `INSERT INTO integration_systems (code, name, secret_env_key, tenant_id)
       VALUES ($1, 'Aux T2', 'TEST_AUX_2', 2) RETURNING id`,
      [STAMP_CODE]
    );
    expect(r1.rows[0].id).toBeDefined();
    expect(r2.rows[0].id).toBeDefined();
    expect(r2.rows[0].id).not.toBe(r1.rows[0].id);
  });

  it('7. mesmo tenant NAO pode possuir duas integration_systems com o mesmo code', async () => {
    await expect(
      run(
        `INSERT INTO integration_systems (code, name, secret_env_key, tenant_id)
         VALUES ($1, 'Aux Dup', 'TEST_AUX_DUP', 1)`,
        [STAMP_CODE]
      )
    ).rejects.toThrow();
  });

  it('8. dados existentes do tenant_id=1 permanecem validos', async () => {
    const admin = await get<{ tenant_id: number }>(
      `SELECT tenant_id FROM users WHERE email = 'admin@sgd.gov.br'`
    );
    expect(admin?.tenant_id).toBe(1);
    const settings = await get<{ tenant_id: number }>(
      `SELECT tenant_id FROM system_settings WHERE tenant_id = 1`
    );
    expect(settings?.tenant_id).toBe(1);
    for (const code of ['transferegov', 'sei', 'cglog']) {
      const sys = await get<{ tenant_id: number }>(
        `SELECT tenant_id FROM integration_systems WHERE code = $1 AND tenant_id = 1`,
        [code]
      );
      expect(sys?.tenant_id).toBe(1);
    }
  });

  it('9. nenhum tenant_id existente foi alterado pelos fixtures', async () => {
    // Fixtures deste arquivo usam apenas stamp; fora isso, so tenants 1/2 sao legitimos
    // (2 apenas via fixtures proprias de tenantIsolation, nunca tocadas aqui).
    const remaining = await all<{ code: string; tenant_id: number }>(
      `SELECT code, tenant_id FROM integration_systems WHERE code = $1`,
      [STAMP_CODE]
    );
    // Neste ponto do arquivo os dois inserts do cenario 6 ainda existem (cleanup e no afterAll).
    expect(remaining.length).toBe(2);
    expect(remaining.map((r) => r.tenant_id).sort()).toEqual([1, 2]);
    const orgStamps = await all<{ slug: string }>(
      `SELECT slug FROM organizations WHERE slug = ANY($1::text[])`,
      [[STAMP_SLUG_A, STAMP_SLUG_B]]
    );
    expect(orgStamps.length).toBeGreaterThan(0);
    // Org 1 intacta apos todas as operacoes acima.
    const org1 = await getOrganizationById(1);
    expect(org1!.slug).toBe('sgd');
    expect(org1!.name).toBe('SGD Consultoria');
  });

  it('getOrganizationBySlug resolve sgd e rejeita slug invalido', async () => {
    const org = await getOrganizationBySlug('sgd');
    expect(org?.id).toBe(1);
    expect(await getOrganizationBySlug('SGD')).toBeDefined();
    await expect(getOrganizationBySlug('INVALID_SLUG!!')).resolves.toBeUndefined();
  });

  it('getOrganizationByDomain rejeita dominio invalido sem tocar o banco', async () => {
    await expect(getOrganizationByDomain('https://auxamo.example.com')).resolves.toBeUndefined();
    await expect(getOrganizationByDomain('auxamo.example.com/login')).resolves.toBeUndefined();
    await expect(getOrganizationByDomain('auxamo.example.com:443')).resolves.toBeUndefined();
  });

  it('validacao de slug: regras de formato', () => {
    expect(isValidSlug('sgd')).toBe(true);
    expect(isValidSlug('auxamo-2')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('SGD')).toBe(false);
    expect(isValidSlug('-sgd')).toBe(false);
    expect(isValidSlug('sgd-')).toBe(false);
    expect(isValidSlug('sg_d')).toBe(false);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('x'.repeat(64))).toBe(false);
    expect(normalizeSlug('  SGD  ')).toBe('sgd');
    expect(normalizeSlug('INVALID!!')).toBeNull();
  });

  it('validacao de dominio: regras de formato', () => {
    expect(normalizeDomain('auxamo.example.com')).toBe('auxamo.example.com');
    expect(normalizeDomain('  AUXAMO.Example.COM  ')).toBe('auxamo.example.com');
    expect(normalizeDomain('https://auxamo.example.com')).toBeNull();
    expect(normalizeDomain('auxamo.example.com/login')).toBeNull();
    expect(normalizeDomain('auxamo.example.com:443')).toBeNull();
    expect(normalizeDomain('auxamo.example.com.')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('-bad.example.com')).toBeNull();
  });
});

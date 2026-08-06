import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loginAsWithCsrf, admin } from './helpers.js';
import { run, all } from '../database.js';

const createdIds: string[] = [];

async function createDemand(overrides: Record<string, unknown> = {}) {
  const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
  const id = `FILTRO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await agent
    .post('/api/demands')
    .set('X-CSRF-Token', csrfToken)
    .send({
      id,
      title: `DEMANDA FILTRO ${Date.now()}`,
      category: 'INFRAESTRUTURA',
      municipality: 'SAPEZAL',
      uf: 'MT',
      organ: 'MINISTERIO DA EDUCACAO',
      proposal_number: `PROP-FILTRO-${Date.now()}`,
      requested_value: 123456.78,
      priority: 'alta',
      status: 'pendente',
      ...overrides,
    });
  createdIds.push(id);
  return { agent, csrfToken, res };
}

describe('Demandas - GET /api/demands (filtros da sprint de estabilização)', () => {
  beforeAll(async () => {
    await createDemand({ status: 'concluido', priority: 'baixa', ano: 2024 });
    await createDemand({ status: 'analise', priority: 'urgente', ano: 2025 });
    await createDemand({ status: 'pendente', priority: 'media', ano: 2026 });
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await run('DELETE FROM demands WHERE id = ANY($1::text[])', [createdIds]);
    }
  });

  it('filtra por município no formato NOME/UF (ex.: SAPEZAL/MT)', async () => {
    const { agent } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent.get('/api/demands').query({ municipality: 'SAPEZAL/MT' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    for (const d of res.body.data) {
      expect(d.municipality.toUpperCase()).toContain('SAPEZAL');
      expect(d.uf).toBe('MT');
    }
  });

  it('filtra por ano com fallback para created_at quando ano é NULL', async () => {
    const legacyId = `LEGACY-${Date.now()}`;
    await run(
      `INSERT INTO demands (id, title, category, municipality, uf, status, priority, ano, created_at)
       VALUES ($1, 'LEGACY', 'TESTE', 'CUIABA', 'MT', 'pendente', 'media', NULL, $2::timestamp)`,
      [legacyId, '2024-05-10T12:00:00.000Z']
    );
    createdIds.push(legacyId);
    const { agent } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent.get('/api/demands').query({ ano: '2024' });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((d: any) => d.id);
    expect(ids).toContain(legacyId);
  });

  it('pesquisa (search) também cobre uf, status e prefeitura', async () => {
    const { agent } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent.get('/api/demands').query({ search: 'MT' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('ordena por sortBy=title (alfabética) e por municipality', async () => {
    const { agent } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent.get('/api/demands').query({ sortBy: 'title', limit: 50 });
    expect(res.status).toBe(200);
    const titles = res.body.data.map((d: any) => String(d.title || '').toLowerCase());
    const sorted = [...titles].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    expect(titles).toEqual(sorted);

    const resMuni = await agent.get('/api/demands').query({ sortBy: 'municipality', limit: 50 });
    expect(resMuni.status).toBe(200);
    const munis = resMuni.body.data.map((d: any) => String(d.municipality || '').toLowerCase());
    const munisSorted = [...munis].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    expect(munis).toEqual(munisSorted);
  });

  it('filtros combinados (status + prioridade + uf) funcionam juntos', async () => {
    const { agent } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent.get('/api/demands').query({ status: 'concluido', priority: 'baixa', uf: 'MT' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const d of res.body.data) {
      expect(d.status).toBe('concluido');
      expect(d.priority).toBe('baixa');
      expect(d.uf).toBe('MT');
    }
  });

  it('sortBy inválido cai no padrão (created_at DESC) sem erro', async () => {
    const { agent } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent.get('/api/demands').query({ sortBy: 'inject; DROP TABLE', limit: 5 });
    expect(res.status).toBe(200);
    const dates = res.body.data.map((d: any) => new Date(d.created_at).getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('limita paginação a um teto seguro (limit>2000 vira 2000)', async () => {
    const { agent } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent.get('/api/demands').query({ limit: 999999 });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2000);
    expect(res.body.pagination.limit).toBeLessThanOrEqual(2000);
  });
});

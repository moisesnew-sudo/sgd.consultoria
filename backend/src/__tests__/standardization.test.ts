import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { run, get } from '../database.js';
import { loginAs, loginAsWithCsrf, admin, gestor } from './helpers.js';

describe('Padronização - Cadastro mestre de órgãos', () => {
  const unique = `ÓRGÃO TESTE ${Date.now()}`;

  it('deve permitir admin criar órgão (CAIXA ALTA)', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post('/api/organs')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: unique });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(unique.toUpperCase());
  });

  it('deve rejeitar gestor criar órgão', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(gestor.email, gestor.password);
    const res = await agent
      .post('/api/organs')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'ÓRGÃO PROIBIDO' });
    expect(res.status).toBe(403);
  });

  it('deve listar órgãos para usuário autenticado', async () => {
    const agent = await loginAs(gestor.email, gestor.password);
    const res = await agent.get('/api/organs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('deve bloquear duplicidade de órgão (case/accent-insensitive)', async () => {
    const dupName = `ÓRGÃO DUP ${Date.now()}`;
    const { agent: agent1, csrfToken: csrf1 } = await loginAsWithCsrf(admin.email, admin.password);
    const created = await agent1.post('/api/organs').set('X-CSRF-Token', csrf1).send({ name: dupName });
    const { agent: agent2, csrfToken: csrf2 } = await loginAsWithCsrf(admin.email, admin.password);
    const dup = await agent2.post('/api/organs').set('X-CSRF-Token', csrf2).send({ name: dupName.toLowerCase() });
    expect(created.status).toBe(201);
    expect([400, 409]).toContain(dup.status);
  });
});

describe('Padronização - Usuários ativos (responsável)', () => {
  it('deve listar usuários ativos para autenticado', async () => {
    const agent = await loginAs(gestor.email, gestor.password);
    const res = await agent.get('/api/auth/users/active');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const u of res.body) {
      expect(u).toHaveProperty('name');
      expect(u).toHaveProperty('email');
    }
  });

  it('deve rejeitar sem token', async () => {
    const res = await request(app).get('/api/auth/users/active');
    expect(res.status).toBe(401);
  });
});

describe('Padronização - Objetos (autocomplete de títulos)', () => {
  it('deve sugerir objetos existentes por busca parcial', async () => {
    const agent = await loginAs(gestor.email, gestor.password);
    const res = await agent.get('/api/standardization/objects?q=crech');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('deve rejeitar sem token', async () => {
    const res = await request(app).get('/api/standardization/objects?q=crech');
    expect(res.status).toBe(401);
  });
});

describe('Auditoria - Autocomplete de municípios (teste "cac" -> CÁCERES)', () => {
  it('sugere CÁCERES-MT ao digitar "cac"', async () => {
    const agent = await loginAs(gestor.email, gestor.password);
    const res = await agent.get('/api/standardization/municipalities?q=cac&uf=MT');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toEqual({ nome: 'CÁCERES', uf: 'MT' });
  });

  it('autocomplete ignora acentos e caixa (pesquisa parcial)', async () => {
    const agent = await loginAs(gestor.email, gestor.password);
    const res = await agent.get('/api/standardization/municipalities?q=CA&uf=MT');
    expect(res.status).toBe(200);
    expect(res.body.data.some((m: any) => m.nome === 'CÁCERES')).toBe(true);
  });
});

describe('Auditoria - Órgão exige cadastro mestre', () => {
  it('gestor não pode cadastrar demanda com órgão fora do cadastro mestre', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(gestor.email, gestor.password);
    const res = await agent
      .post('/api/demands')
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'AUDITORIA ORGAN', category: 'AUDITORIA', municipality: 'FORTALEZA', uf: 'CE', organ: 'ÓRGÃO INVENTADO' });
    expect(res.status).toBe(400);
  });

  it('admin pode cadastrar e registra órgão novo automaticamente no cadastro mestre', async () => {
    const orgName = `AUDITORIA ADMIN ${Date.now()}`;
    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post('/api/demands')
      .set('X-CSRF-Token', csrfToken)
      .send({
        title: 'AUDITORIA ADMIN', category: 'AUDITORIA',
        municipality: '   FORTALEZA   ', uf: 'CE', organ: orgName
      });
    expect(res.status).toBe(201);
    expect(res.body.organ).toBe(orgName.toUpperCase());
    const list = await agent.get('/api/organs');
    expect(list.body.some((o: any) => o.name === orgName.toUpperCase())).toBe(true);
  }, 15000);
});

describe('Auditoria - Município não admite grafia divergente', () => {
  it('"CACERES" e "CÁCERES" são detectados como o mesmo município', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const send = (name: string) =>
      agent
        .post('/api/municipalities')
        .set('X-CSRF-Token', csrfToken)
        .send({ name, uf: 'MT' });

    const first = await send('CACERES');
    const dup = await send('CÁCERES');

    expect([201, 409]).toContain(first.status);
    if (first.status === 201) {
      expect(first.body.name).toBe('CÁCERES');
      expect(dup.status).toBe(409);
    } else {
      expect(dup.status).toBe(409);
    }
  }, 15000);

  it('não aceita município inexistente na base IBGE', async () => {
    const { agent, csrfToken } = await loginAsWithCsrf(gestor.email, gestor.password);
    const res = await agent
      .post('/api/demands')
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'TESTE', category: 'TESTE', municipality: 'CIDADE INVENTADA', uf: 'ZZ' });
    expect(res.status).toBe(400);
  });
});

describe('Auditoria - Migração corrige grafias antigas', () => {
  it('scan identifica e apply corrige registro legado (GOIANIA -> GOIÂNIA)', async () => {
    const legacyId = `AUD-LEGADO-${Date.now()}`;
    await run(
      `INSERT INTO demands (id, title, category, municipality, uf) VALUES ($1, $2, $3, $4, $5)`,
      [legacyId, 'OBJETO ANTIGO', 'AUDITORIA', 'GOIANIA', 'GO']
    );

    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const scan = await agent
      .post('/api/standardization/scan')
      .set('X-CSRF-Token', csrfToken);
    expect(scan.status).toBe(200);
    const correctedPair = scan.body.demands.corrected.find(
      (c: any) => c.value.toUpperCase() === 'GOIANIA' && c.uf === 'GO'
    );
    expect(correctedPair).toBeTruthy();
    expect(correctedPair.correctedTo).toContain('GOIÂNIA');

    const apply = await agent
      .post('/api/standardization/apply')
      .set('X-CSRF-Token', csrfToken);
    expect(apply.status).toBe(200);

    const row = await get<{ municipality: string }>(
      'SELECT municipality FROM demands WHERE id = $1',
      [legacyId]
    );
    expect(row?.municipality).toBe('GOIÂNIA');
  }, 20000);
});

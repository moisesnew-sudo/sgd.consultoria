import { describe, it, expect } from 'vitest';
import { loginAsWithCsrf, admin } from './helpers.js';

const VALID_ISO = '2026-12-31T18:00:00.000Z';

async function createDemand(overrides: Record<string, unknown> = {}) {
  const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
  const res = await agent
    .post('/api/demands')
    .set('X-CSRF-Token', csrfToken)
    .send({
      title: `DEMANDA DEADLINE ${Date.now()}`,
      category: 'DEADLINE',
      municipality: 'FORTALEZA',
      uf: 'CE',
      ...overrides
    });
  return { agent, csrfToken, res };
}

describe('Demandas - deadline (Fase 2.2)', () => {
  it('cria demanda sem deadline (null por padrão)', async () => {
    const { res } = await createDemand();
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('deadline');
    expect(res.body.deadline).toBeNull();
  });

  it('cria demanda com deadline ISO válido', async () => {
    const { res } = await createDemand({ deadline: VALID_ISO });
    expect(res.status).toBe(201);
    expect(res.body.deadline).toBe(VALID_ISO);
  });

  it('rejeita deadline inválido', async () => {
    const { res } = await createDemand({ deadline: '31/12/2026' });
    expect(res.status).toBe(400);
  });

  it('atualiza deadline via PUT', async () => {
    const { agent, csrfToken, res } = await createDemand();
    expect(res.status).toBe(201);
    const updated = await agent
      .put(`/api/demands/${res.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ deadline: VALID_ISO });
    expect(updated.status).toBe(200);
    expect(updated.body.deadline).toBe(VALID_ISO);
  });

  it('limpa deadline com null via PUT', async () => {
    const { agent, csrfToken, res } = await createDemand({ deadline: VALID_ISO });
    expect(res.status).toBe(201);
    expect(res.body.deadline).toBe(VALID_ISO);
    const cleared = await agent
      .put(`/api/demands/${res.body.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ deadline: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.deadline).toBeNull();
  });
});

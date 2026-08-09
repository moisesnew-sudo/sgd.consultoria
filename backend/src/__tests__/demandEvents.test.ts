/**
 * Fase D1.6 — Testes de eventos SSE de demandas.
 *
 * Verifica que eventos são emitidos corretamente no eventBus
 * quando demandas são criadas, atualizadas, status muda, deletadas,
 * e comentários são adicionados.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { loginAsWithCsrf, admin } from './helpers.js';
import { run } from '../database.js';
import { onIntegrationEvent, offIntegrationEvent, removeAllListeners } from '../lib/eventBus.js';
import type {
  DemandCreatedPayload,
  DemandUpdatedPayload,
  DemandStatusChangedPayload,
  DemandDeletedPayload,
  CommentCreatedPayload,
} from '../lib/eventBus.js';

const createdIds: string[] = [];

async function createDemand(overrides: Record<string, unknown> = {}) {
  const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
  const res = await agent
    .post('/api/demands')
    .set('X-CSRF-Token', csrfToken)
    .send({
      title: `SSE TEST ${Date.now()}`,
      category: 'INFRAESTRUTURA',
      municipality: 'SAPEZAL',
      uf: 'MT',
      organ: 'MINISTERIO DA EDUCACAO',
      proposal_number: `PROP-SSE-${Date.now()}`,
      requested_value: 10000,
      priority: 'media',
      status: 'pendente',
      ...overrides,
    });
  const id = res.body?.id;
  if (id) createdIds.push(id);
  return { agent, csrfToken, res, id };
}

afterAll(async () => {
  removeAllListeners();
  if (createdIds.length > 0) {
    await run('DELETE FROM demands WHERE id = ANY($1::text[])', [createdIds]);
  }
});

/* ------------------------------------------------------------------ */
/* 1. demand:created                                                  */
/* ------------------------------------------------------------------ */

describe('SSE — demand:created', () => {
  it('1. criar demanda emite evento demand:created', async () => {
    const received: DemandCreatedPayload[] = [];
    const id = onIntegrationEvent('demand:created', (p) => received.push(p));

    const { res } = await createDemand();
    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].demandId).toBeTruthy();
    expect(received[0].title).toBeTruthy();
    expect(received[0].status).toBe('pendente');

    offIntegrationEvent(id);
  });
});

/* ------------------------------------------------------------------ */
/* 2. demand:updated                                                  */
/* ------------------------------------------------------------------ */

describe('SSE — demand:updated', () => {
  it('2. editar demanda emite evento demand:updated', async () => {
    const { id } = await createDemand();
    const received: DemandUpdatedPayload[] = [];
    const listenerId = onIntegrationEvent('demand:updated', (p) => received.push(p));

    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .put(`/api/demands/${id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'TITULO ATUALIZADO SSE' });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].demandId).toBe(id);
    expect(received[0].changes).toContain('title');

    offIntegrationEvent(listenerId);
  });
});

/* ------------------------------------------------------------------ */
/* 3. demand:status_changed                                           */
/* ------------------------------------------------------------------ */

describe('SSE — demand:status_changed', () => {
  it('3. alterar status via PUT emite demand:status_changed', async () => {
    const { id } = await createDemand();
    const received: DemandStatusChangedPayload[] = [];
    const listenerId = onIntegrationEvent('demand:status_changed', (p) => received.push(p));

    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .put(`/api/demands/${id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ status: 'analise' });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].demandId).toBe(id);
    expect(received[0].from).toBe('pendente');
    expect(received[0].to).toBe('analise');

    offIntegrationEvent(listenerId);
  });

  it('4. alterar status via timeline emite demand:status_changed', async () => {
    const { id } = await createDemand();
    const received: DemandStatusChangedPayload[] = [];
    const listenerId = onIntegrationEvent('demand:status_changed', (p) => received.push(p));

    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post(`/api/demands/${id}/timeline`)
      .set('X-CSRF-Token', csrfToken)
      .send({ title: 'Mudanca de status', status_changed_to: 'concluido' });
    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].demandId).toBe(id);
    expect(received[0].from).toBe('pendente');
    expect(received[0].to).toBe('concluido');

    offIntegrationEvent(listenerId);
  });
});

/* ------------------------------------------------------------------ */
/* 5. demand:deleted                                                  */
/* ------------------------------------------------------------------ */

describe('SSE — demand:deleted', () => {
  it('5. deletar demanda emite demand:deleted', async () => {
    const { id } = await createDemand();
    const received: DemandDeletedPayload[] = [];
    const listenerId = onIntegrationEvent('demand:deleted', (p) => received.push(p));

    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .delete(`/api/demands/${id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].demandId).toBe(id);

    offIntegrationEvent(listenerId);
  });
});

/* ------------------------------------------------------------------ */
/* 6. comment:created                                                 */
/* ------------------------------------------------------------------ */

describe('SSE — comment:created', () => {
  it('6. adicionar comentario emite comment:created', async () => {
    const { id } = await createDemand();
    const received: CommentCreatedPayload[] = [];
    const listenerId = onIntegrationEvent('comment:created', (p) => received.push(p));

    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post(`/api/demands/${id}/comments`)
      .set('X-CSRF-Token', csrfToken)
      .send({ body: 'Comentario de teste SSE' });
    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].demandId).toBe(id);
    expect(received[0].userName).toBeTruthy();

    offIntegrationEvent(listenerId);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Ausência de evento quando operação falha                         */
/* ------------------------------------------------------------------ */

describe('SSE — ausência de evento em falha', () => {
  it('7. operação com dados inválidos NÃO emite evento', async () => {
    const received: DemandCreatedPayload[] = [];
    const listenerId = onIntegrationEvent('demand:created', (p) => received.push(p));

    const { agent, csrfToken } = await loginAsWithCsrf(admin.email, admin.password);
    const res = await agent
      .post('/api/demands')
      .set('X-CSRF-Token', csrfToken)
      .send({ title: '' }); // dados inválidos

    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(0);

    offIntegrationEvent(listenerId);
  });
});

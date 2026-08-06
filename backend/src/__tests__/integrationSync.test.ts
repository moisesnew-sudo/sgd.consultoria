import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { run, get } from '../database.js';
import { syncIntegrationEvent } from '../lib/integrationSync.js';

const DEMAND_TF = `SYNC-TF-${Date.now()}`;
const DEMAND_SEI = `SYNC-SEI-${Date.now()}`;

beforeAll(async () => {
  await run(
    `INSERT INTO demands (id, title, category, municipality, uf, status, priority, proposal_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [DEMAND_TF, 'DEMANDA SYNC TRANSFEREGOV', 'INTEGRACAO', 'FORTALEZA', 'CE', 'pendente', 'media', 'PROP-001']
  );
  await run(
    `INSERT INTO demands (id, title, category, municipality, uf, status, priority, proposal_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [DEMAND_SEI, 'DEMANDA SYNC SEI', 'INTEGRACAO', 'FORTALEZA', 'CE', 'pendente', 'media', 'PROP-SEI-001']
  );
});

afterAll(async () => {
  await run('DELETE FROM demands WHERE id IN ($1, $2)', [DEMAND_TF, DEMAND_SEI]);
});

describe('Integration Sync (Fase 2.2.1)', () => {
  it('Transferegov válido — APROVADO mapeia para concluido', async () => {
    const result = await syncIntegrationEvent({
      systemCode: 'transferegov',
      proposal_number: 'PROP-001',
      status: 'APROVADO',
      deadline: '2026-12-31',
    });
    expect(result.success).toBe(true);
    expect(result.action).toBe('synced');
    expect(result.demandId).toBe(DEMAND_TF);
    expect(result.changes?.status).toBe('concluido');
  });

  it('SEI válido — FINALIZADO mapeia para concluido', async () => {
    const result = await syncIntegrationEvent({
      systemCode: 'sei',
      proposal_number: 'PROP-SEI-001',
      status: 'FINALIZADO',
    });
    expect(result.success).toBe(true);
    expect(result.action).toBe('synced');
    expect(result.demandId).toBe(DEMAND_SEI);
    expect(result.changes?.status).toBe('concluido');
  });

  it('Status externo desconhecido — unmatched, sem atualizar demanda', async () => {
    const result = await syncIntegrationEvent({
      systemCode: 'transferegov',
      proposal_number: 'PROP-001',
      status: 'DESCONHECIDO',
    });
    expect(result.success).toBe(false);
    expect(result.action).toBe('unmatched');
    expect(result.reason).toBe('Unknown external status');
    const row = await get<{ status: string }>('SELECT status FROM demands WHERE id = $1', [DEMAND_TF]);
    expect(row?.status).toBe('pendente');
  });

  it('Sistema desconhecido — failed, adapter not found', async () => {
    const result = await syncIntegrationEvent({
      systemCode: 'unknown',
      proposal_number: 'PROP-001',
      status: 'APROVADO',
    });
    expect(result.success).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toBe('adapter not found');
  });

  it('Proposta inexistente — unmatched, demand not found', async () => {
    const result = await syncIntegrationEvent({
      systemCode: 'transferegov',
      proposal_number: 'PROP-NAO-EXISTE-999',
      status: 'APROVADO',
    });
    expect(result.success).toBe(false);
    expect(result.action).toBe('unmatched');
    expect(result.reason).toBe('demand not found');
  });

  it('Propagação de deadline ISO — changes.deadline preenchido', async () => {
    const result = await syncIntegrationEvent({
      systemCode: 'transferegov',
      proposal_number: 'PROP-001',
      deadline: '2026-12-31T18:00:00.000Z',
    });
    expect(result.success).toBe(true);
    expect(result.action).toBe('synced');
    expect(result.changes?.deadline).toBe('2026-12-31T18:00:00.000Z');
  });
});

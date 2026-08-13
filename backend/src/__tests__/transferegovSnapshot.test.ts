/**
 * A7.3 — Motor de snapshot, idempotência e publicação atômica do Transferegov.
 *
 * Fluxo sob teste: coleta completa em memória → validação do snapshot →
 * publicação atômica (BEGIN → persistência → COMMIT) com ROLLBACK em erro.
 *
 * Cobertura obrigatória A–K:
 *  A  snapshot completo (multi-página, contagem coerente, publicado);
 *  B  idempotência (duas execuções → mesmo estado lógico, sem duplicação);
 *  C  falha na primeira página (sem publicação, estado anterior intacto);
 *  D  falha no meio (página 3 de 5 → falha, sem publicação);
 *  E  falha na última página (sem publicação, estado anterior intacto);
 *  F  cd_parceria duplicado (snapshot inválido, sem publicação);
 *  G  cd_parceria ausente (snapshot inválido, sem publicação);
 *  H  contagem inconsistente / página vazia antes de total_pages (falha);
 *  I  maxRecordsPerSync (coleta interrompida, parcial, nada removido);
 *  J  falha de persistência (ROLLBACK, estado anterior intacto);
 *  K  concorrência (reutiliza o advisory lock existente do ciclo).
 *
 * Todos os testes usam mock determinístico do fetch global — sem rede real.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { get, run, pool } from '../database.js';
import { SYNC_LOCK_KEY } from '../lib/integrationScheduler.js';
import { runTransferegovSnapshotSync } from '../integrations/transferegovSnapshot.js';
import { PARTNERSHIP_BASE_URL } from '../integrations/transferegov.adapter.js';
import type { AdapterConfig } from '../integrations/types.js';

const OFFICIAL_BASE = PARTNERSHIP_BASE_URL;

const config: AdapterConfig = {
  baseUrl: OFFICIAL_BASE,
  extra: { authType: 'none' },
  maxRetries: 0,
};

let systemId = 0;
const system = () => ({ id: systemId, code: 'transferegov' });
let createdSystem = false;

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pageEnvelope(items: unknown[], totalPages: number, totalItems: number, page: number): Record<string, unknown> {
  return {
    data: items,
    total_pages: totalPages,
    total_items: totalItems,
    page_number: page,
    page_size: 200,
  };
}

function partnershipItem(cdParceria: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id_parceria: 3809,
    cd_parceria: cdParceria,
    id_proposta: Number(cdParceria) || 0,
    nu_externo: '12345',
    in_situacao_parceria: 'Aprovada',
    vl_total_planejamento_gastos: '100000.0',
    ...over,
  };
}

/** Mock do fetch global roteado por página (rejeita páginas inesperadas). */
function mockApi(handlers: Record<number, { body: unknown; status?: number }>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
    const u = new URL(String(url));
    const page = Number(u.searchParams.get('pagina') ?? '1');
    const handler = handlers[page];
    if (!handler) {
      return Promise.reject(new Error(`Página inesperada solicitada: ${page}`));
    }
    return Promise.resolve(mockJsonResponse(handler.body, handler.status ?? 200));
  });
}

async function countSnapshots(): Promise<number> {
  const row = await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM integration_snapshots WHERE system_id = $1', [systemId]);
  return row?.n ?? 0;
}

async function listSnapshots(): Promise<any[]> {
  return (await run(
    'SELECT external_id, proposal_number, external_status, raw_status, vl_total_planejamento_gastos FROM integration_snapshots WHERE system_id = $1 ORDER BY external_id',
    [systemId],
  )).rows as any[];
}

async function seedSnapshot(externalId: string, over: Record<string, unknown> = {}): Promise<void> {
  await run(
    `INSERT INTO integration_snapshots (system_id, external_id, proposal_number, external_status, raw_status, vl_total_planejamento_gastos, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [systemId, externalId, over.proposal_number ?? '0', over.external_status ?? 'APROVADA', over.raw_status ?? 'Aprovada', over.vl_total_planejamento_gastos ?? 100000, JSON.stringify({ seed: externalId })],
  );
}

beforeAll(async () => {
  const existing = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', ['transferegov']);
  if (existing) {
    systemId = existing.id;
    createdSystem = false;
  } else {
    const res = await run(
      `INSERT INTO integration_systems (code, name, secret_env_key, active, config)
       VALUES ('transferegov', 'Transferegov (teste A7.3)', 'TRANSFEREGOV_WEBHOOK_SECRET', TRUE, $1)
       RETURNING id`,
      [JSON.stringify(config)],
    );
    systemId = res.rows[0].id as number;
    createdSystem = true;
  }
});

afterAll(async () => {
  await run('DELETE FROM integration_snapshots WHERE system_id = $1', [systemId]);
  if (createdSystem) {
    await run('DELETE FROM integration_systems WHERE id = $1', [systemId]);
  }
});

beforeEach(async () => {
  await run('DELETE FROM integration_snapshots WHERE system_id = $1', [systemId]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('A7.3 — Motor de snapshot do Transferegov', () => {
  it('A. snapshot completo multi-página é coletado, validado e publicado', async () => {
    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001'), partnershipItem('202500037002')], 2, 4, 1) },
      2: { body: pageEnvelope([partnershipItem('202500037003'), partnershipItem('202500037004')], 2, 4, 2) },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});

    expect(result.success).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.limited).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.published).toBe(true);
    expect(result.fetchedCount).toBe(4);
    expect(result.validatedCount).toBe(4);
    expect(result.publishedCount).toBe(4);
    expect(result.pagesProcessed).toBe(2);
    expect(result.totalItems).toBe(4);
    expect(result.totalPages).toBe(2);
    expect(result.error).toBeUndefined();

    expect(await countSnapshots()).toBe(4);
    const rows = await listSnapshots();
    expect(rows.map((r) => r.external_id)).toEqual(['202500037001', '202500037002', '202500037003', '202500037004']);
    expect(rows[0].proposal_number).toBe('202500037001');
    expect(rows[0].external_status).toBe('APROVADA');
    expect(rows[0].raw_status).toBe('Aprovada');
    expect(Number(rows[0].vl_total_planejamento_gastos)).toBe(100000);
  });

  it('B. idempotência: segunda execução não duplica e atualiza o estado', async () => {
    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001'), partnershipItem('202500037002')], 1, 2, 1) },
    });

    const first = await runTransferegovSnapshotSync(system(), config, {});
    expect(first.published).toBe(true);
    expect(await countSnapshots()).toBe(2);

    mockApi({
      1: {
        body: pageEnvelope(
          [partnershipItem('202500037001', { in_situacao_parceria: 'Em análise' }), partnershipItem('202500037002')],
          1,
          2,
          1,
        ),
      },
    });

    const second = await runTransferegovSnapshotSync(system(), config, {});
    expect(second.success).toBe(true);
    expect(second.published).toBe(true);
    expect(second.publishedCount).toBe(2);
    expect(await countSnapshots()).toBe(2);

    const rows = await listSnapshots();
    expect(rows.map((r) => r.external_id)).toEqual(['202500037001', '202500037002']);
    const updated = rows.find((r) => r.external_id === '202500037001');
    expect(updated.external_status).toBe('EM_ANALISE');
    expect(updated.raw_status).toBe('Em análise');
  });

  it('C. falha na primeira página: sem publicação, estado anterior intacto', async () => {
    await seedSnapshot('P-OLD', { external_status: 'APROVADA' });

    mockApi({ 1: { body: { erro: 'interno' }, status: 500 } });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.httpStatus).toBe(500);
    expect(result.error).toContain('HTTP 500');

    expect(await countSnapshots()).toBe(1);
    const rows = await listSnapshots();
    expect(rows[0].external_id).toBe('P-OLD');
    expect(rows[0].external_status).toBe('APROVADA');
  });

  it('C2. falha de rede na primeira página: sem publicação', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.error).toContain('Falha de rede ou timeout');
    expect(await countSnapshots()).toBe(0);
  });

  it('D. falha no meio da coleta (página 3 de 5): sem publicação', async () => {
    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001'), partnershipItem('202500037002')], 5, 10, 1) },
      2: { body: pageEnvelope([partnershipItem('202500037003'), partnershipItem('202500037004')], 5, 10, 2) },
      3: { body: { erro: 'interno' }, status: 500 },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(4);
    expect(result.pagesProcessed).toBe(2);
    expect(result.error).toContain('HTTP 500');
    expect(await countSnapshots()).toBe(0);
  });

  it('E. falha na última página: sem publicação, estado anterior intacto', async () => {
    await seedSnapshot('P-OLD', { external_status: 'APROVADA' });

    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001'), partnershipItem('202500037002')], 3, 6, 1) },
      2: { body: pageEnvelope([partnershipItem('202500037003'), partnershipItem('202500037004')], 3, 6, 2) },
      3: { body: { erro: 'interno' }, status: 500 },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.fetchedCount).toBe(4);
    expect(result.pagesProcessed).toBe(2);
    expect(result.error).toContain('HTTP 500');

    expect(await countSnapshots()).toBe(1);
    const rows = await listSnapshots();
    expect(rows[0].external_id).toBe('P-OLD');
  });

  it('F. cd_parceria duplicado: snapshot inválido, sem publicação', async () => {
    mockApi({
      1: {
        body: pageEnvelope(
          [partnershipItem('202500037001'), partnershipItem('202500037001', { id_proposta: 999 })],
          1,
          2,
          1,
        ),
      },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.error).toContain('duplicado');
    expect(await countSnapshots()).toBe(0);
  });

  it('G. cd_parceria ausente: snapshot inválido, sem publicação', async () => {
    const item = partnershipItem('202500037001');
    delete item.cd_parceria;

    mockApi({ 1: { body: pageEnvelope([item], 1, 1, 1) } });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.error).toContain('cd_parceria');
    expect(await countSnapshots()).toBe(0);
  });

  it('H1. contagem inconsistente (total_items ≠ registros obtidos): falha', async () => {
    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001'), partnershipItem('202500037002')], 1, 5, 1) },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.error).toContain('Incoerência de contagem');
    expect(await countSnapshots()).toBe(0);
  });

  it('H2. página inesperadamente vazia antes de total_pages: falha', async () => {
    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001')], 3, 1, 1) },
      2: { body: pageEnvelope([], 3, 1, 2) },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.error).toContain('inesperadamente vazia');
    expect(await countSnapshots()).toBe(0);
  });

  it('I. maxRecordsPerSync: coleta interrompida, parcial, nada publicado nem removido', async () => {
    await seedSnapshot('P-OLD', { external_status: 'APROVADA' });

    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001'), partnershipItem('202500037002')], 5, 10, 1) },
    });

    const result = await runTransferegovSnapshotSync(system(), config, { maxRecords: 2 });
    expect(result.success).toBe(true);
    expect(result.limited).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.published).toBe(false);
    expect(result.fetchedCount).toBe(2);
    expect(result.pagesProcessed).toBe(1);
    expect(result.message).toContain('limite de 2');

    expect(await countSnapshots()).toBe(1);
    const rows = await listSnapshots();
    expect(rows[0].external_id).toBe('P-OLD');
  });

  it('J. falha de persistência: ROLLBACK, estado anterior intacto, sem sucesso', async () => {
    await seedSnapshot('P-OLD-1', { external_status: 'APROVADA' });
    await seedSnapshot('P-OLD-2', { external_status: 'EM_ANALISE' });

    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001'), partnershipItem('202500037002')], 1, 2, 1) },
    });

    const originalQuery = pg.Client.prototype.query as unknown as (this: any, query: any, values?: any[]) => Promise<any>;
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: any, query: any, values?: any) {
      const sql = typeof query === 'string' ? query : query?.text ?? '';
      if (sql.includes('INSERT INTO integration_snapshots')) {
        return Promise.reject(new Error('falha controlada na persistência do snapshot'));
      }
      return originalQuery.call(this, query, values);
    });

    try {
      const result = await runTransferegovSnapshotSync(system(), config, {});
      expect(result.success).toBe(false);
      expect(result.published).toBe(false);
      expect(result.complete).toBe(false);
      expect(result.error).toContain('falha controlada na persistência');
    } finally {
      spy.mockRestore();
    }

    expect(await countSnapshots()).toBe(2);
    const rows = await listSnapshots();
    expect(rows.map((r) => r.external_id)).toEqual(['P-OLD-1', 'P-OLD-2']);
    expect(rows[0].external_status).toBe('APROVADA');
    expect(rows[1].external_status).toBe('EM_ANALISE');
  });

  it('K. concorrência: reutiliza o advisory lock existente do ciclo (bloqueia execução simultânea)', async () => {
    const lockClient = await pool.connect();
    try {
      const lock = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
        [SYNC_LOCK_KEY],
      );
      expect(lock.rows[0].pg_try_advisory_lock).toBe(true);

      mockApi({ 1: { body: pageEnvelope([partnershipItem('202500037099')], 1, 1, 1) } });

      const blocked = await runTransferegovSnapshotSync(system(), config, {});
      expect(blocked.success).toBe(false);
      expect(blocked.skipped).toBe(true);
      expect(blocked.published).toBe(false);
      expect(blocked.complete).toBe(false);
      expect(blocked.error).toContain('advisory lock');
      expect(await countSnapshots()).toBe(0);
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]);
      lockClient.release();
    }

    mockApi({ 1: { body: pageEnvelope([partnershipItem('202500037099')], 1, 1, 1) } });

    const unblocked = await runTransferegovSnapshotSync(system(), config, {});
    expect(unblocked.success).toBe(true);
    expect(unblocked.skipped).toBe(false);
    expect(unblocked.complete).toBe(true);
    expect(unblocked.published).toBe(true);
    expect(await countSnapshots()).toBe(1);
  });
});

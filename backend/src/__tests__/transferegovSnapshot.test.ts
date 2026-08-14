/**
 * A7.3 + A7.4 — Motor de snapshot, idempotência, publicação atômica e
 * reconciliação segura do Transferegov, com auditoria em integration_logs
 * e otimização via endpoint de data de atualização da base (Parte 2).
 *
 * Fluxo sob teste: coleta completa em memória → validação do snapshot →
 * cálculo da reconciliação → publicação atômica (BEGIN → persistência →
 * reconciliação → COMMIT) com ROLLBACK em erro.
 *
 * Cobertura obrigatória A–L:
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
 * A7.4 — Reconciliação segura (testes A–L abaixo):
 *  A  anterior A,B,C / atual A,B,C → missing = 0;
 *  B  anterior A,B,C / atual A,B → C ausente (absent_since, sem DELETE físico);
 *  C  anterior A,B / atual A,B,C → C novo (inserted);
 *  D  anterior A,B,C / atual A,C → B ausente;
 *  E  execução limitada → nenhum registro marcado como ausente;
 *  F  erro durante a coleta → nenhum registro marcado como ausente;
 *  G  erro de validação → nenhum registro marcado como ausente;
 *  H  falha durante a persistência/reconciliação → ROLLBACK, estado anterior preservado;
 *  I  execução repetida → resultado idempotente;
 *  J  duplicidade no snapshot → rejeitado sem reconciliação;
 *  K  cd_parceria ausente/vazio → rejeitado sem reconciliação;
 *  L  snapshot completo grande → reconciliação correta sem lógica O(n²).
 *
 * A7.4 Parte 2 — Auditoria e data de atualização (testes A–P):
 *  A  primeira execução: consulta data-atualizacao, snapshot completo e valor persistido;
 *  B  base sem alteração (data-atualizacao igual) → SKIPPED sem coleta;
 *  C  base com alteração (data diferente) → snapshot completo e valor atualizado;
 *  D  falha HTTP no data-atualizacao → fallback de snapshot completo, valor NÃO atualizado;
 *  E  data de atualização inválida → fallback de snapshot completo (nunca "sem alterações");
 *  F  snapshot limitado → LIMITED, log warning, valor NÃO persistido;
 *  G  falha na coleta → FAILED, log error, valor NÃO persistido;
 *  H  falha na persistência → ROLLBACK desfaz a atualização da data;
 *  I  advisory lock indisponível → SKIPPED sem registro de auditoria;
 *  J  auditoria PUBLISHED (action/status/metrics coerentes);
 *  K  auditoria LIMITED (log warning + métricas parciais);
 *  L  auditoria FAILED (log error + error_message);
 *  M  auditoria SKIPPED (log success com matched=true);
 *  N  nenhum segredo em integration_logs;
 *  O  uma auditoria por execução real;
 *  P  evidência persiste mesmo com ROLLBACK.
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

/** Handler dedicado para o endpoint de data de atualização da base. */
interface MockApiOptions {
  dataAtualizacao?: { body: unknown; status?: number };
}

/**
 * Mock do fetch global: roteia o endpoint /data-atualizacao por pathname e as
 * demais requisições por página (rejeita páginas inesperadas). Sem handler
 * dedicado, o data-atualizacao responde 500 (fallback seguro de snapshot).
 */
function mockApi(handlers: Record<number, { body: unknown; status?: number }>, opts: MockApiOptions = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/data-atualizacao')) {
      const handler = opts.dataAtualizacao;
      if (!handler) {
        return Promise.resolve(mockJsonResponse({ erro: 'data-atualizacao não configurado no mock' }, 500));
      }
      return Promise.resolve(mockJsonResponse(handler.body, handler.status ?? 200));
    }
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
    'SELECT external_id, proposal_number, external_status, raw_status, vl_total_planejamento_gastos, absent_since FROM integration_snapshots WHERE system_id = $1 ORDER BY external_id',
    [systemId],
  )).rows as any[];
}

async function listSnapshotLogs(): Promise<any[]> {
  return (await run(
    `SELECT id, system_id, system_code, direction, action, status, message, duration_ms,
            http_status, triggered_by, execution_state, metrics, error_message, created_at
     FROM integration_logs WHERE system_id = $1 ORDER BY id`,
    [systemId],
  )).rows as any[];
}

async function storedDataAtualizacao(): Promise<string | null> {
  const row = await get<{ last_data_atualizacao: string | null }>(
    'SELECT last_data_atualizacao FROM integration_systems WHERE id = $1',
    [systemId],
  );
  return row?.last_data_atualizacao ?? null;
}

async function seedSnapshot(externalId: string, over: Record<string, unknown> = {}): Promise<void> {
  await run(
    `INSERT INTO integration_snapshots (system_id, external_id, proposal_number, external_status, raw_status, vl_total_planejamento_gastos, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [systemId, externalId, over.proposal_number ?? '0', over.external_status ?? 'APROVADA', over.raw_status ?? 'Aprovada', over.vl_total_planejamento_gastos ?? 100000, JSON.stringify({ seed: externalId })],
  );
}

/** Garante que nenhum registro do sistema esteja marcado como ausente (absent_since). */
async function expectNoAbsentMarkers(): Promise<void> {
  const rows = await listSnapshots();
  for (const row of rows) {
    expect(row.absent_since).toBeNull();
  }
}

/**
 * Intercepta pg.Client.prototype.query para simular falha controlada de
 * persistência (quando o SQL contém `needle`). Encaminha o callback quando
 * presente — o pool.query do node-postgres usa callback internamente e, sem
 * isso, chamadas via pool (ex.: auditoria em integration_logs, leitura de
 * last_data_atualizacao) ficariam pendentes indefinidamente.
 */
function spyOnPersistFail(needle: string, message: string) {
  const originalQuery = pg.Client.prototype.query as unknown as (...args: any[]) => any;
  return vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: any, query: any, values?: any) {
    const sql = typeof query === 'string' ? query : query?.text ?? '';
    const callback = arguments[2];
    if (sql.includes(needle)) {
      const error = new Error(message);
      if (typeof callback === 'function') {
        callback(error);
        return undefined;
      }
      return Promise.reject(error);
    }
    return originalQuery.apply(this, arguments as any);
  });
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
  await run('DELETE FROM integration_logs WHERE system_id = $1', [systemId]);
  if (createdSystem) {
    await run('DELETE FROM integration_systems WHERE id = $1', [systemId]);
  }
});

beforeEach(async () => {
  await run('DELETE FROM integration_snapshots WHERE system_id = $1', [systemId]);
  await run('DELETE FROM integration_logs WHERE system_id = $1', [systemId]);
  await run('UPDATE integration_systems SET last_data_atualizacao = NULL WHERE id = $1', [systemId]);
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
    expect(rows[0].absent_since).toBeNull();
  });

  it('J. falha de persistência: ROLLBACK, estado anterior intacto, sem sucesso', async () => {
    await seedSnapshot('P-OLD-1', { external_status: 'APROVADA' });
    await seedSnapshot('P-OLD-2', { external_status: 'EM_ANALISE' });

    mockApi({
      1: { body: pageEnvelope([partnershipItem('202500037001'), partnershipItem('202500037002')], 1, 2, 1) },
    });

    const spy = spyOnPersistFail('INSERT INTO integration_snapshots', 'falha controlada na persistência do snapshot');

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
    expect(rows[0].absent_since).toBeNull();
    expect(rows[1].absent_since).toBeNull();
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

describe('A7.4 — Reconciliação segura do snapshot do Transferegov', () => {
  it('A. anterior A,B,C / atual A,B,C → missing = 0', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');
    await seedSnapshot('C');

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B'), partnershipItem('C')], 1, 3, 1) } });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.missingCount).toBe(0);
    expect(result.missingIds).toEqual([]);
    expect(result.insertedCount).toBe(0);
    expect(result.publishedCount).toBe(3);
    expect(await countSnapshots()).toBe(3);

    await expectNoAbsentMarkers();
  });

  it('B. anterior A,B,C / atual A,B → C identificado como ausente (sem DELETE físico)', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');
    await seedSnapshot('C');

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 2, 1) } });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.missingCount).toBe(1);
    expect(result.missingIds).toEqual(['C']);
    expect(result.publishedCount).toBe(2);

    const rows = await listSnapshots();
    expect(rows.map((r) => r.external_id)).toEqual(['A', 'B', 'C']);
    expect(rows.find((r) => r.external_id === 'C')?.absent_since).not.toBeNull();
    for (const id of ['A', 'B']) {
      expect(rows.find((r) => r.external_id === id)?.absent_since).toBeNull();
    }
  });

  it('C. anterior A,B / atual A,B,C → C identificado como novo', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B'), partnershipItem('C')], 1, 3, 1) } });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.insertedCount).toBe(1);
    expect(result.missingCount).toBe(0);
    expect(result.publishedCount).toBe(3);
    expect(await countSnapshots()).toBe(3);

    const rows = await listSnapshots();
    expect(rows.map((r) => r.external_id)).toEqual(['A', 'B', 'C']);
    await expectNoAbsentMarkers();
  });

  it('D. anterior A,B,C / atual A,C → B ausente', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');
    await seedSnapshot('C');

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('C')], 1, 2, 1) } });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.missingCount).toBe(1);
    expect(result.missingIds).toEqual(['B']);
    expect(result.publishedCount).toBe(2);

    const rows = await listSnapshots();
    expect(rows.map((r) => r.external_id)).toEqual(['A', 'B', 'C']);
    expect(rows.find((r) => r.external_id === 'B')?.absent_since).not.toBeNull();
    for (const id of ['A', 'C']) {
      expect(rows.find((r) => r.external_id === id)?.absent_since).toBeNull();
    }
  });

  it('D2. reaparecimento: registro ausente que volta → absent_since limpo (reconciled)', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } });
    const first = await runTransferegovSnapshotSync(system(), config, {});
    expect(first.success).toBe(true);
    expect(first.missingCount).toBe(1);
    expect(first.missingIds).toEqual(['B']);

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 2, 1) } });
    const second = await runTransferegovSnapshotSync(system(), config, {});
    expect(second.success).toBe(true);
    expect(second.complete).toBe(true);
    expect(second.reconciledCount).toBe(1);
    expect(second.missingCount).toBe(0);
    expect(second.insertedCount).toBe(0);

    await expectNoAbsentMarkers();
  });

  it('E. execução limitada → nenhum registro marcado como ausente', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');
    await seedSnapshot('C');

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 5, 10, 1) } });

    const result = await runTransferegovSnapshotSync(system(), config, { maxRecords: 2 });
    expect(result.success).toBe(true);
    expect(result.limited).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.published).toBe(false);
    expect(result.missingCount).toBe(0);

    expect(await countSnapshots()).toBe(3);
    await expectNoAbsentMarkers();
  });

  it('F. erro durante a coleta → nenhum registro marcado como ausente', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');
    await seedSnapshot('C');

    mockApi({
      1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 3, 3, 1) },
      2: { body: { erro: 'interno' }, status: 500 },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.missingCount).toBe(0);
    expect(result.error).toContain('HTTP 500');

    expect(await countSnapshots()).toBe(3);
    await expectNoAbsentMarkers();
  });

  it('G. erro de validação → nenhum registro marcado como ausente', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');
    await seedSnapshot('C');

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 5, 1) } });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.missingCount).toBe(0);
    expect(result.error).toContain('Incoerência de contagem');

    expect(await countSnapshots()).toBe(3);
    await expectNoAbsentMarkers();
  });

  it('H. falha durante persistência/reconciliação → ROLLBACK, estado anterior preservado', async () => {
    await seedSnapshot('A', { external_status: 'APROVADA' });
    await seedSnapshot('B', { external_status: 'APROVADA' });
    await seedSnapshot('C', { external_status: 'APROVADA' });

    mockApi({ 1: { body: pageEnvelope([partnershipItem('A', { in_situacao_parceria: 'Em análise' })], 1, 1, 1) } });

    const spy = spyOnPersistFail('UPDATE integration_snapshots', 'falha controlada na reconciliação de ausentes');

    try {
      const result = await runTransferegovSnapshotSync(system(), config, {});
      expect(result.success).toBe(false);
      expect(result.published).toBe(false);
      expect(result.complete).toBe(false);
      expect(result.error).toContain('falha controlada na reconciliação');
    } finally {
      spy.mockRestore();
    }

    // Publicação e reconciliação desfeitas juntas: A,B,C intactos e sem marca de ausência.
    const rows = await listSnapshots();
    expect(rows.map((r) => r.external_id)).toEqual(['A', 'B', 'C']);
    for (const row of rows) {
      expect(row.absent_since).toBeNull();
      expect(row.external_status).toBe('APROVADA');
    }
  });

  it('I. execução repetida → resultado idempotente', async () => {
    mockApi({ 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 2, 1) } });

    const first = await runTransferegovSnapshotSync(system(), config, {});
    expect(first.success).toBe(true);
    expect(first.insertedCount).toBe(2);
    expect(first.missingCount).toBe(0);
    expect(first.publishedCount).toBe(2);

    const second = await runTransferegovSnapshotSync(system(), config, {});
    expect(second.success).toBe(true);
    expect(second.complete).toBe(true);
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(0);
    expect(second.unchangedCount).toBe(2);
    expect(second.missingCount).toBe(0);
    expect(second.publishedCount).toBe(2);

    expect(await countSnapshots()).toBe(2);
    const rows = await listSnapshots();
    expect(rows.map((r) => r.external_id)).toEqual(['A', 'B']);
    await expectNoAbsentMarkers();
  });

  it('J. duplicidade no snapshot → rejeitado sem reconciliação', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');
    await seedSnapshot('C');

    mockApi({
      1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('A', { id_proposta: 999 })], 1, 2, 1) },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.missingCount).toBe(0);
    expect(result.error).toContain('duplicado');

    expect(await countSnapshots()).toBe(3);
    await expectNoAbsentMarkers();
  });

  it('K. cd_parceria ausente/vazio → rejeitado sem reconciliação', async () => {
    await seedSnapshot('A');
    await seedSnapshot('B');
    await seedSnapshot('C');

    const item = partnershipItem('A');
    delete item.cd_parceria;
    mockApi({ 1: { body: pageEnvelope([item], 1, 1, 1) } });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.missingCount).toBe(0);
    expect(result.error).toContain('cd_parceria');

    expect(await countSnapshots()).toBe(3);
    await expectNoAbsentMarkers();
  });

  it('L. snapshot completo grande → reconciliação correta sem lógica O(n²)', async () => {
    const total = 400;
    const pageSize = 200;
    const ids = Array.from({ length: total }, (_, i) => `ID-${String(i + 1).padStart(4, '0')}`);

    const buildPages = (list: string[]): Record<number, { body: unknown }> => {
      const pages: Record<number, { body: unknown }> = {};
      const pagesCount = Math.ceil(list.length / pageSize);
      for (let p = 1; p <= pagesCount; p++) {
        const slice = list.slice((p - 1) * pageSize, p * pageSize);
        pages[p] = { body: pageEnvelope(slice.map((id) => partnershipItem(id)), pagesCount, list.length, p) };
      }
      return pages;
    };

    mockApi(buildPages(ids));
    const first = await runTransferegovSnapshotSync(system(), config, {});
    expect(first.success).toBe(true);
    expect(first.complete).toBe(true);
    expect(first.insertedCount).toBe(total);
    expect(first.missingCount).toBe(0);
    expect(await countSnapshots()).toBe(total);

    const current = ids.slice(0, total - 1);
    mockApi(buildPages(current));
    const second = await runTransferegovSnapshotSync(system(), config, {});
    expect(second.success).toBe(true);
    expect(second.complete).toBe(true);
    expect(second.insertedCount).toBe(0);
    expect(second.missingCount).toBe(1);
    expect(second.missingIds).toEqual([ids[total - 1]]);
    expect(second.publishedCount).toBe(total - 1);
    expect(await countSnapshots()).toBe(total); // sem DELETE físico

    const rows = await listSnapshots();
    expect(rows.find((r) => r.external_id === ids[total - 1])?.absent_since).not.toBeNull();
  });
});

describe('A7.4 Parte 2 — Auditoria e data de atualização da base (data-atualizacao)', () => {
  it('A. primeira execução: consulta data-atualizacao, snapshot completo PUBLISHED e valor persistido', async () => {
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 2, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-10' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.dataAtualizacao).toBe('2026-08-10');
    expect(result.dataAtualizacaoMeta?.available).toBe(true);
    expect(result.dataAtualizacaoMeta?.matched).toBe(false);

    expect(await storedDataAtualizacao()).toBe('2026-08-10');
    expect(await countSnapshots()).toBe(2);
  });

  it('B. base sem alteração (data-atualizacao igual): SKIPPED, sem coleta nem publicação', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    const fetchMock = mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-10' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.executionState).toBe('SKIPPED');
    expect(result.complete).toBe(true);
    expect(result.published).toBe(false);
    expect(result.dataAtualizacao).toBe('2026-08-10');
    expect(result.dataAtualizacaoMeta?.matched).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await countSnapshots()).toBe(0);
    expect(await storedDataAtualizacao()).toBe('2026-08-10');
  });

  it('C. base com alteração (data-atualizacao diferente): snapshot completo e valor atualizado', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-12' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.dataAtualizacao).toBe('2026-08-12');
    expect(result.dataAtualizacaoMeta?.matched).toBe(false);

    expect(await storedDataAtualizacao()).toBe('2026-08-12');
    expect(await countSnapshots()).toBe(1);
  });

  it('D. falha no endpoint data-atualizacao (HTTP 500): fallback para snapshot completo, valor NÃO atualizado', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { erro: 'interno' }, status: 500 } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.dataAtualizacaoMeta?.available).toBe(false);
    expect(result.dataAtualizacaoMeta?.error).toContain('HTTP 500');
    expect(result.dataAtualizacao).toBeUndefined();

    expect(await storedDataAtualizacao()).toBe('2026-08-10');
    expect(await countSnapshots()).toBe(1);
  });

  it('E. data de atualização inválida: fallback para snapshot completo (nunca tratada como sem alteração)', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: 'nao-e-uma-data' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.dataAtualizacaoMeta?.available).toBe(false);
    expect(result.dataAtualizacaoMeta?.error).toContain('inválida');

    expect(await storedDataAtualizacao()).toBe('2026-08-10');
  });

  it('E2. data de atualização não-string (envelope paginado): fallback para snapshot completo', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.dataAtualizacaoMeta?.available).toBe(false);

    expect(await storedDataAtualizacao()).toBe('2026-08-10');
  });

  it('F. snapshot limitado (maxRecords): estado LIMITED, log warning, valor NÃO persistido', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 5, 10, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-12' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, { maxRecords: 2 });
    expect(result.success).toBe(true);
    expect(result.limited).toBe(true);
    expect(result.executionState).toBe('LIMITED');
    expect(result.published).toBe(false);

    expect(await storedDataAtualizacao()).toBe('2026-08-10');

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].execution_state).toBe('LIMITED');
    expect(logs[0].status).toBe('warning');
  });

  it('G. falha na coleta: estado FAILED, log error, valor NÃO persistido', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: { erro: 'interno' }, status: 500 } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-12' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.executionState).toBe('FAILED');
    expect(result.httpStatus).toBe(500);

    expect(await storedDataAtualizacao()).toBe('2026-08-10');

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].execution_state).toBe('FAILED');
    expect(logs[0].status).toBe('error');
    expect(logs[0].error_message).toContain('HTTP 500');
    expect(logs[0].http_status).toBe(500);
  });

  it('H. falha na persistência: ROLLBACK desfaz a atualização da data, estado FAILED', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-12' } } },
    );

    const spy = spyOnPersistFail('INSERT INTO integration_snapshots', 'falha controlada na persistência do snapshot');

    try {
      const result = await runTransferegovSnapshotSync(system(), config, {});
      expect(result.success).toBe(false);
      expect(result.executionState).toBe('FAILED');
      expect(result.published).toBe(false);
      expect(result.error).toContain('falha controlada na persistência');
    } finally {
      spy.mockRestore();
    }

    expect(await storedDataAtualizacao()).toBe('2026-08-10');
    expect(await countSnapshots()).toBe(0);
  });

  it('I. advisory lock indisponível: SKIPPED sem registro de auditoria', async () => {
    const lockClient = await pool.connect();
    try {
      const lock = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
        [SYNC_LOCK_KEY],
      );
      expect(lock.rows[0].pg_try_advisory_lock).toBe(true);

      mockApi({ 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } });
      const blocked = await runTransferegovSnapshotSync(system(), config, {});
      expect(blocked.success).toBe(false);
      expect(blocked.skipped).toBe(true);
      expect(blocked.executionState).toBe('SKIPPED');

      expect(await listSnapshotLogs()).toHaveLength(0);
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]);
      lockClient.release();
    }
  });

  it('J. auditoria PUBLISHED: action/status/metrics coerentes em integration_logs', async () => {
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 2, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-10' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('PUBLISHED');

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.system_id).toBe(systemId);
    expect(log.system_code).toBe('transferegov');
    expect(log.direction).toBe('out');
    expect(log.action).toBe('integration.snapshot.transferegov');
    expect(log.status).toBe('success');
    expect(log.execution_state).toBe('PUBLISHED');
    expect(log.triggered_by).toBe('snapshot-sync');
    expect(log.http_status).toBe(200);
    expect(log.message).toContain('Snapshot completo publicado');

    const m = log.metrics;
    expect(m.execution_state).toBe('PUBLISHED');
    expect(m.published).toBe(true);
    expect(m.complete).toBe(true);
    expect(m.fetched_count).toBe(2);
    expect(m.published_count).toBe(2);
    expect(m.inserted_count).toBe(2);
    expect(m.updated_count).toBe(0);
    expect(m.unchanged_count).toBe(0);
    expect(m.missing_count).toBe(0);
    expect(m.reconciled_count).toBe(0);
    expect(m.pages_processed).toBe(1);
    expect(m.total_items).toBe(2);
    expect(m.total_pages).toBe(1);
    expect(m.data_atualizacao.value).toBe('2026-08-10');
    expect(m.data_atualizacao.available).toBe(true);
  });

  it('K. auditoria LIMITED: log warning com métricas da coleta parcial', async () => {
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 5, 10, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-10' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, { maxRecords: 2 });
    expect(result.executionState).toBe('LIMITED');

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.status).toBe('warning');
    expect(log.execution_state).toBe('LIMITED');
    expect(log.message).toContain('limite de 2');

    const m = log.metrics;
    expect(m.limited).toBe(true);
    expect(m.complete).toBe(false);
    expect(m.published).toBe(false);
    expect(m.fetched_count).toBe(2);
  });

  it('L. auditoria FAILED: log error com error_message e métricas', async () => {
    mockApi(
      { 1: { body: { erro: 'interno' }, status: 500 } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-10' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('FAILED');

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.status).toBe('error');
    expect(log.execution_state).toBe('FAILED');
    expect(log.error_message).toContain('HTTP 500');
    expect(log.http_status).toBe(500);
    expect(log.metrics.complete).toBe(false);
    expect(log.metrics.data_atualizacao.available).toBe(true);
  });

  it('M. auditoria SKIPPED (base sem alteração): log success com matched=true', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-10' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('SKIPPED');

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.status).toBe('success');
    expect(log.execution_state).toBe('SKIPPED');
    expect(log.message).toContain('sem alterações');

    const m = log.metrics;
    expect(m.skipped).toBe(true);
    expect(m.published).toBe(false);
    expect(m.data_atualizacao.matched).toBe(true);
  });

  it('N. nenhum segredo é registrado em integration_logs', async () => {
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-10' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('PUBLISHED');

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(1);
    const serialized = JSON.stringify(logs[0]).toLowerCase();
    for (const term of ['api_key', 'apikey', 'password', 'senha', 'token', 'secret', 'authorization']) {
      expect(serialized).not.toContain(term);
    }
  });

  it('O. uma auditoria por execução real (contagens correspondem às execuções)', async () => {
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 2, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-10' } } },
    );

    const first = await runTransferegovSnapshotSync(system(), config, {});
    expect(first.executionState).toBe('PUBLISHED');

    const second = await runTransferegovSnapshotSync(system(), config, {});
    expect(second.executionState).toBe('SKIPPED');

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].execution_state).toBe('PUBLISHED');
    expect(logs[1].execution_state).toBe('SKIPPED');
  });

  it('P. a evidência da execução persiste mesmo quando a publicação foi revertida (ROLLBACK)', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_atualizacao: '2026-08-12' } } },
    );

    const spy = spyOnPersistFail('UPDATE integration_snapshots', 'falha controlada na reconciliação de ausentes');

    try {
      const result = await runTransferegovSnapshotSync(system(), config, {});
      expect(result.executionState).toBe('FAILED');
    } finally {
      spy.mockRestore();
    }

    const logs = await listSnapshotLogs();
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.execution_state).toBe('FAILED');
    expect(log.status).toBe('error');
    expect(log.error_message).toContain('falha controlada na reconciliação');
    expect(log.metrics.execution_state).toBe('FAILED');
    expect(log.metrics.published).toBe(false);
    expect(log.metrics.inserted_count).toBe(0);
    expect(log.metrics.data_atualizacao.value).toBe('2026-08-12');
  });
});

describe('A7.5.1 — Correção P1: chave real de data de atualização (data_ultima_atualizacao)', () => {
  it('A. resposta real da API (data_ultima_atualizacao): available=true e valor extraído', async () => {
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 2, 1) } },
      { dataAtualizacao: { body: { data_ultima_atualizacao: '2026-08-13T00:00:00' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.dataAtualizacao).toBe('2026-08-13T00:00:00');
    expect(result.dataAtualizacaoMeta?.available).toBe(true);
    expect(result.dataAtualizacaoMeta?.matched).toBe(false);

    expect(await storedDataAtualizacao()).toBe('2026-08-13T00:00:00');
    expect(await countSnapshots()).toBe(2);
  });

  it('B. chave camelCase dataUltimaAtualizacao: available=true', async () => {
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A'), partnershipItem('B')], 1, 2, 1) } },
      { dataAtualizacao: { body: { dataUltimaAtualizacao: '2026-08-13T00:00:00' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.dataAtualizacao).toBe('2026-08-13T00:00:00');
    expect(result.dataAtualizacaoMeta?.available).toBe(true);
    expect(result.dataAtualizacaoMeta?.matched).toBe(false);

    expect(await storedDataAtualizacao()).toBe('2026-08-13T00:00:00');
  });

  it('C. campo ausente: available=false e fallback para snapshot completo', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { outro_campo: 'valor' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.dataAtualizacaoMeta?.available).toBe(false);
    expect(result.dataAtualizacaoMeta?.error).toContain('ausente ou vazio');
    expect(result.dataAtualizacao).toBeUndefined();

    expect(await storedDataAtualizacao()).toBe('2026-08-10');
    expect(await countSnapshots()).toBe(1);
  });

  it('D. campo null/vazio: available=false', async () => {
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_ultima_atualizacao: null } } },
    );

    let result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.dataAtualizacaoMeta?.available).toBe(false);
    expect(result.dataAtualizacaoMeta?.error).toContain('ausente ou vazio');

    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_ultima_atualizacao: '' } } },
    );

    result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.dataAtualizacaoMeta?.available).toBe(false);
    expect(result.dataAtualizacaoMeta?.error).toContain('ausente ou vazio');
  });

  it('E. valor inválido: available=false e fallback', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_ultima_atualizacao: 'nao-e-uma-data' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.dataAtualizacaoMeta?.available).toBe(false);
    expect(result.dataAtualizacaoMeta?.error).toContain('inválida');

    expect(await storedDataAtualizacao()).toBe('2026-08-10');
  });

  it('F. mesmo valor da última execução: SKIPPED, sem coleta nem publicação', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-13T00:00:00']);
    const fetchMock = mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_ultima_atualizacao: '2026-08-13T00:00:00' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.executionState).toBe('SKIPPED');
    expect(result.complete).toBe(true);
    expect(result.published).toBe(false);
    expect(result.dataAtualizacao).toBe('2026-08-13T00:00:00');
    expect(result.dataAtualizacaoMeta?.available).toBe(true);
    expect(result.dataAtualizacaoMeta?.matched).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await countSnapshots()).toBe(0);
    expect(await storedDataAtualizacao()).toBe('2026-08-13T00:00:00');
  });

  it('G. valor alterado: PUBLISHED e novo valor persistido', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-12T00:00:00']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_ultima_atualizacao: '2026-08-13T00:00:00' } } },
    );

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.dataAtualizacaoMeta?.matched).toBe(false);

    expect(await storedDataAtualizacao()).toBe('2026-08-13T00:00:00');
    expect(await countSnapshots()).toBe(1);
  });

  it('H. falha na persistência: ROLLBACK e last_data_atualizacao anterior intacto', async () => {
    await run('UPDATE integration_systems SET last_data_atualizacao = $2 WHERE id = $1', [systemId, '2026-08-10']);
    mockApi(
      { 1: { body: pageEnvelope([partnershipItem('A')], 1, 1, 1) } },
      { dataAtualizacao: { body: { data_ultima_atualizacao: '2026-08-13T00:00:00' } } },
    );

    const spy = spyOnPersistFail('INSERT INTO integration_snapshots', 'falha controlada na persistência (P1)');
    try {
      const result = await runTransferegovSnapshotSync(system(), config, {});
      expect(result.success).toBe(false);
      expect(result.executionState).toBe('FAILED');
      expect(result.published).toBe(false);
      expect(result.error).toContain('falha controlada na persistência');
    } finally {
      spy.mockRestore();
    }

    expect(await storedDataAtualizacao()).toBe('2026-08-10');
    expect(await countSnapshots()).toBe(0);
  });
});

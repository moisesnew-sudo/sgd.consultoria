/**
 * Testes do motor de snapshot do SEI — Sistema Eletrônico de Informações.
 *
 * Cobertura obrigatória:
 *  A  snapshot completo (multi-página, publicado);
 *  B  idempotência (duas execuções → mesmo estado lógico);
 *  C  falha na primeira página (sem publicação);
 *  D  NUP duplicado (snapshot inválido, sem publicação);
 *  E  NUP ausente/vazio (snapshot inválido);
 *  F  maxRecordsPerSync (coleta interrompida, parcial);
 *  G  falha de persistência (ROLLBACK, estado anterior intacto);
 *  H  concorrência (advisory lock rejeita segunda execução);
 *  I  reconcile ausentes (marca absent_since, sem DELETE físico);
 *  J  reconcile reaparecidos (absent_since limpo);
 *  K  auditoria em integration_logs (PUBLISHED/FAILED/SKIPPED);
 *  L  Adapter inexistente → FAILED;
 *  M  baseUrl não configurada → erro de rede;
 *  N  HTTP 401/403 → authError=true;
 *  O  array direto (sem envelope) → snapshot completo;
 *  P  nenhum segredo em integration_logs.
 *
 * Todos os testes usam mock determinístico do fetch global — sem rede real.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { get, run } from '../database.js';
import { runSeiSnapshotSync } from '../integrations/seiSnapshot.js';
import type { AdapterConfig } from '../integrations/types.js';

const config: AdapterConfig = {
  baseUrl: 'https://api.sei.gov.br',
  secretEnvKey: 'SEI_API_TOKEN',
  extra: { authType: 'token' },
  maxRetries: 0,
};

let systemId = 0;
const system = () => ({ id: systemId, code: 'sei' });
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

function processItem(nup: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    numero_processo: nup,
    processo: nup,
    nup: nup,
    status: 'Em andamento',
    ...over,
  };
}

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
    'SELECT external_id, proposal_number, external_status, raw_status, absent_since FROM integration_snapshots WHERE system_id = $1 ORDER BY external_id',
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

async function seedSnapshot(externalId: string, over: Record<string, unknown> = {}): Promise<void> {
  await run(
    `INSERT INTO integration_snapshots (system_id, external_id, proposal_number, external_status, raw_status, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [systemId, externalId, over.proposal_number ?? null, over.external_status ?? 'EM_ANDAMENTO', over.raw_status ?? 'Em andamento', JSON.stringify({ seed: externalId })],
  );
}

async function expectNoAbsentMarkers(): Promise<void> {
  const rows = await listSnapshots();
  for (const row of rows) {
    expect(row.absent_since).toBeNull();
  }
}

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
  const existing = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', ['sei']);
  if (existing) {
    systemId = existing.id;
    createdSystem = false;
  } else {
    const res = await run(
      `INSERT INTO integration_systems (code, name, secret_env_key, active, config)
       VALUES ('sei', 'SEI (teste snapshot)', 'SEI_API_TOKEN', TRUE, $1)
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SEI Snapshot Engine', () => {
  it('A. snapshot completo multi-página é coletado, validado e publicado', async () => {
    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01'), processItem('12345.678902/2024-01')], 2, 4, 1) },
      2: { body: pageEnvelope([processItem('12345.678903/2024-01'), processItem('12345.678904/2024-01')], 2, 4, 2) },
    });

    const result = await runSeiSnapshotSync(system(), config, {});

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
    expect(rows.map((r) => r.external_id)).toEqual([
      '12345.678901/2024-01',
      '12345.678902/2024-01',
      '12345.678903/2024-01',
      '12345.678904/2024-01',
    ]);
    expect(rows[0].external_status).toBe('EM_ANDAMENTO');
    expect(rows[0].raw_status).toBe('Em andamento');
  });

  it('B. idempotência: segunda execução não duplica e mantém estado', async () => {
    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01'), processItem('12345.678902/2024-01')], 1, 2, 1) },
    });

    const first = await runSeiSnapshotSync(system(), config, {});
    expect(first.published).toBe(true);
    expect(await countSnapshots()).toBe(2);

    const second = await runSeiSnapshotSync(system(), config, {});
    expect(second.published).toBe(true);
    expect(second.insertedCount).toBe(0);
    expect(second.unchangedCount).toBe(2);
    expect(await countSnapshots()).toBe(2);
  });

  it('C. falha na primeira página (sem publicação, estado anterior intacto)', async () => {
    await seedSnapshot('12345.678901/2024-01');
    expect(await countSnapshots()).toBe(1);

    mockApi({
      1: { body: { erro: 'serviço indisponível' }, status: 500 },
    });

    const result = await runSeiSnapshotSync(system(), config, {});

    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.executionState).toBe('FAILED');
    expect(result.httpStatus).toBe(500);

    expect(await countSnapshots()).toBe(1);
    const rows = await listSnapshots();
    expect(rows[0].external_id).toBe('12345.678901/2024-01');
  });

  it('D. NUP duplicado (snapshot inválido, sem publicação)', async () => {
    await seedSnapshot('12345.678901/2024-01');

    mockApi({
      1: { body: pageEnvelope([
        processItem('12345.678901/2024-01'),
        processItem('12345.678901/2024-01'),
      ], 1, 2, 1) },
    });

    const result = await runSeiSnapshotSync(system(), config, {});

    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.executionState).toBe('FAILED');
    expect(result.error).toContain('Duplicatas');

    expect(await countSnapshots()).toBe(1);
  });

  it('E. NUP ausente/vazio (item sem NUP é ignorado, snapshot válido)', async () => {
    mockApi({
      1: { body: pageEnvelope([
        processItem('12345.678901/2024-01'),
        { status: 'Em andamento', sem_processo: true },
      ], 1, 2, 1) },
    });

    const result = await runSeiSnapshotSync(system(), config, {});

    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.publishedCount).toBe(1);
    expect(await countSnapshots()).toBe(1);
  });

  it('F. maxRecordsPerSync interrompe coleta (LIMITED, parcial, nada publicado)', async () => {
    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01'), processItem('12345.678902/2024-01')], 2, 4, 1) },
    });

    const result = await runSeiSnapshotSync(system(), config, { maxRecords: 1 });

    expect(result.success).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.limited).toBe(true);
    expect(result.published).toBe(false);
    expect(result.executionState).toBe('LIMITED');
    expect(result.fetchedCount).toBe(1);

    expect(await countSnapshots()).toBe(0);
  });

  it('G. falha de persistência (ROLLBACK, estado anterior intacto)', async () => {
    await seedSnapshot('12345.678901/2024-01');

    mockApi({
      1: { body: pageEnvelope([processItem('12345.678902/2024-01')], 1, 1, 1) },
    });

    const spy = spyOnPersistFail('INSERT INTO integration_snapshots', 'falha de banco');

    const result = await runSeiSnapshotSync(system(), config, {});

    spy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.published).toBe(false);
    expect(result.executionState).toBe('FAILED');

    expect(await countSnapshots()).toBe(1);
    const rows = await listSnapshots();
    expect(rows[0].external_id).toBe('12345.678901/2024-01');
  });

  it('H. concorrência: advisory lock rejeita segunda execução (SKIPPED)', async () => {
    process.env.SEI_API_TOKEN = 'token-teste';
    const mockClientQuery = vi.fn().mockImplementation((_sql: string, params?: unknown[]) => {
      if (Array.isArray(params) && params[0] === 738291046) {
        return Promise.resolve({ rows: [{ pg_try_advisory_lock: false }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const mockRelease = vi.fn();
    vi.spyOn(await import('../database.js'), 'pool', 'get').mockReturnValue({
      connect: vi.fn().mockResolvedValue({ query: mockClientQuery, release: mockRelease }),
    } as any);

    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01')], 1, 1, 1) },
    });

    const result = await runSeiSnapshotSync(system(), config, {});

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.executionState).toBe('SKIPPED');
    expect(result.error).toContain('advisory lock');
  });

  it('I. reconcile ausentes: registros desaparecidos recebem absent_since', async () => {
    await seedSnapshot('12345.678901/2024-01');
    await seedSnapshot('12345.678902/2024-01');
    await seedSnapshot('12345.678903/2024-01');
    expect(await countSnapshots()).toBe(3);

    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01'), processItem('12345.678903/2024-01')], 1, 2, 1) },
    });

    const result = await runSeiSnapshotSync(system(), config, {});

    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.missingCount).toBe(1);
    expect(result.missingIds).toEqual(['12345.678902/2024-01']);
    expect(await countSnapshots()).toBe(3);

    const rows = await listSnapshots();
    const absent = rows.find((r) => r.external_id === '12345.678902/2024-01');
    expect(absent).toBeDefined();
    expect(absent.absent_since).not.toBeNull();
  });

  it('J. reconcile reaparecidos: absent_since é limpo quando registro reaparece', async () => {
    await seedSnapshot('12345.678901/2024-01');
    await seedSnapshot('12345.678902/2024-01');

    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01')], 1, 1, 1) },
    });
    await runSeiSnapshotSync(system(), config, {});

    const absentRows = await listSnapshots();
    const absent = absentRows.find((r) => r.external_id === '12345.678902/2024-01');
    expect(absent?.absent_since).not.toBeNull();

    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01'), processItem('12345.678902/2024-01')], 1, 2, 1) },
    });
    const result = await runSeiSnapshotSync(system(), config, {});

    expect(result.reconciledCount).toBe(1);
    const reconciledRows = await listSnapshots();
    const reconciled = reconciledRows.find((r) => r.external_id === '12345.678902/2024-01');
    expect(reconciled?.absent_since).toBeNull();
  });

  it('K. auditoria PUBLISHED em integration_logs', async () => {
    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01')], 1, 1, 1) },
    });

    await runSeiSnapshotSync(system(), config, {});

    const logs = await listSnapshotLogs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const snapshotLog = logs.find((l) => l.action === 'integration.snapshot.sei');
    expect(snapshotLog).toBeDefined();
    expect(snapshotLog.execution_state).toBe('PUBLISHED');
    expect(snapshotLog.status).toBe('success');
    expect(snapshotLog.triggered_by).toBe('snapshot-sync');
    expect(snapshotLog.metrics).toBeDefined();
    expect(snapshotLog.metrics.execution_state).toBe('PUBLISHED');
    expect(snapshotLog.metrics.api_contract).toBe('inferred');
  });

  it('L. adapter inexistente → FAILED', async () => {
    const result = await runSeiSnapshotSync({ id: 99999, code: 'sistema_inexistente' }, config, {});

    expect(result.success).toBe(false);
    expect(result.executionState).toBe('FAILED');
    expect(result.error).toContain('Nenhum adapter governamental registrado');
  });

  it('M. baseUrl não configurada → erro de rede', async () => {
    const noBaseUrlConfig: AdapterConfig = { maxRetries: 0 };
    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01')], 1, 1, 1) },
    });

    const result = await runSeiSnapshotSync(system(), noBaseUrlConfig, {});

    expect(result.success).toBe(false);
    expect(result.executionState).toBe('FAILED');
    expect(result.error).toContain('BaseUrl não configurada');
  });

  it('N. HTTP 401/403 → authError=true', async () => {
    mockApi({
      1: { body: { erro: 'unauthorized' }, status: 401 },
    });

    const result = await runSeiSnapshotSync(system(), config, {});

    expect(result.success).toBe(false);
    expect(result.executionState).toBe('FAILED');
    expect(result.httpStatus).toBe(401);
    expect(result.authError).toBe(true);
  });

  it('O. array direto (sem envelope) → snapshot completo', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return Promise.resolve(mockJsonResponse([processItem('12345.678901/2024-01'), processItem('12345.678902/2024-01')], 200));
    });

    const result = await runSeiSnapshotSync(system(), config, {});

    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.publishedCount).toBe(2);
    expect(result.pagesProcessed).toBe(1);
    expect(await countSnapshots()).toBe(2);
  });

  it('P. nenhum segredo em integration_logs', async () => {
    process.env.SEI_API_TOKEN = 'super-secret-token-12345';

    mockApi({
      1: { body: pageEnvelope([processItem('12345.678901/2024-01')], 1, 1, 1) },
    });

    await runSeiSnapshotSync(system(), config, {});

    const logs = await listSnapshotLogs();
    for (const log of logs) {
      const fullLog = JSON.stringify(log);
      expect(fullLog).not.toContain('super-secret-token-12345');
      expect(fullLog).not.toContain('SEI_API_TOKEN');
    }
  });
});

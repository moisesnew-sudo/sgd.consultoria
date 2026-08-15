/**
 * P2.2 — Enriquecimento do snapshot do Transferegov com os valores de
 * vl_total_planejamento_gastos coletados de GET /parcerias/proposta.
 *
 * O snapshot de parcerias (cd_parceria) é enriquecido pelo id_proposta:
 *  - id_proposta + número → valor NUMERIC persistido;
 *  - id_proposta + null explícito → NULL persistido (nunca zero);
 *  - id_proposta ausente da coleta → NÃO vira NULL (valor existente preservado).
 *
 * Cobertura obrigatória A–J:
 *  A  proposta nova: valor da proposta é persistido (vence o campo da parceria);
 *  B  atualização: valor existente diferente recebe o novo valor;
 *  C  NULL explícito: proposta com null → NULL, não zero e não o valor antigo;
 *  D  ausência: proposta existente fora da coleta → reconciliação existente,
 *     sem apagar nem zerar o valor;
 *  E  múltiplas páginas: valores de todas as páginas de propostas chegam à persistência;
 *  F  falha durante a coleta de propostas → nada parcial é persistido;
 *  G  idempotência: duas execuções produzem o mesmo estado final;
 *  H  atualização + NULL: transição valor numérico antigo → NULL;
 *  I  integridade por id_proposta: associação por chave, nunca por posição;
 *  J  regressão: reconciliação existente continua funcionando junto do enriquecimento.
 *
 * Todos os testes usam mock determinístico do fetch global — sem rede real.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { get, run } from '../database.js';
import { runTransferegovSnapshotSync } from '../integrations/transferegovSnapshot.js';
import { PARTNERSHIP_BASE_URL } from '../integrations/transferegov.adapter.js';
import type { AdapterConfig } from '../integrations/types.js';

const config: AdapterConfig = {
  baseUrl: PARTNERSHIP_BASE_URL,
  extra: { authType: 'none' },
  maxRetries: 0,
};

let systemId = 0;
const system = () => ({ id: systemId, code: 'transferegov' });
let createdSystem = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function partnershipEnvelope(items: unknown[], totalPages: number, totalItems: number, page: number): Record<string, unknown> {
  return {
    data: items,
    total_pages: totalPages,
    total_items: totalItems,
    page_number: page,
    page_size: 200,
  };
}

function proposalEnvelope(items: unknown[], totalPages: number, totalItems: number, page: number): Record<string, unknown> {
  return {
    data: items,
    total_pages: totalPages,
    total_items: totalItems,
    page_number: page,
    page_size: 200,
  };
}

/**
 * Parceria com id_proposta explícito. O campo financeiro próprio da parceria é
 * um sentinela (9999999.0) justamente para provar que o valor de propostas o
 * substitui quando o id_proposta é encontrado na coleta.
 */
function partnershipItem(cdParceria: string, idProposta: number | string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id_parceria: 1,
    cd_parceria: cdParceria,
    id_proposta: idProposta,
    nu_externo: '12345',
    in_situacao_parceria: 'Aprovada',
    vl_total_planejamento_gastos: '9999999.0',
    ...over,
  };
}

/** Proposta com id_proposta + valor financeiro (number, string numérica ou null). */
function proposalItem(id: number | string, value: unknown): Record<string, unknown> {
  return { id_proposta: id, vl_total_planejamento_gastos: value };
}

interface MockApiOptions {
  dataAtualizacao?: { body: unknown; status?: number };
  proposta?: Record<number, { body: unknown; status?: number }>;
  parceria?: Record<number, { body: unknown; status?: number }>;
}

/** Envelope de proposta vazio padrão (coleta vazia válida). */
const EMPTY_PROPOSAL_ENVELOPE = {
  data: [],
  total_pages: 1,
  total_items: 0,
  page_number: 1,
  page_size: 200,
};

/**
 * Mock do fetch global: roteia /data-atualizacao, /proposta e /parceria por
 * pathname; páginas sem handler respondem 500 (fallback seguro de data-
 * atualizacao) ou rejeitam (página inesperada).
 */
function mockApi(opts: MockApiOptions = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/data-atualizacao')) {
      const handler = opts.dataAtualizacao;
      if (!handler) {
        return Promise.resolve(json({ erro: 'data-atualizacao não configurado no mock' }, 500));
      }
      return Promise.resolve(json(handler.body, handler.status ?? 200));
    }
    if (u.pathname.endsWith('/proposta')) {
      const page = Number(u.searchParams.get('pagina') ?? '1');
      const handler = opts.proposta?.[page];
      if (!handler) {
        return Promise.resolve(json(EMPTY_PROPOSAL_ENVELOPE, 200));
      }
      return Promise.resolve(json(handler.body, handler.status ?? 200));
    }
    const page = Number(u.searchParams.get('pagina') ?? '1');
    const handler = opts.parceria?.[page];
    if (!handler) {
      return Promise.reject(new Error(`Página inesperada solicitada (parceria): ${page}`));
    }
    return Promise.resolve(json(handler.body, handler.status ?? 200));
  });
}

async function countSnapshots(): Promise<number> {
  const row = await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM integration_snapshots WHERE system_id = $1', [systemId]);
  return row?.n ?? 0;
}

async function snapshotValue(externalId: string): Promise<{ value: string | number | null; absent_since: Date | string | null; proposal_number: string | null } | undefined> {
  return get<{ value: string | number | null; absent_since: Date | string | null; proposal_number: string | null }>(
    `SELECT vl_total_planejamento_gastos AS value, absent_since, proposal_number
     FROM integration_snapshots WHERE system_id = $1 AND external_id = $2`,
    [systemId, externalId],
  );
}

async function listValues(): Promise<{ external_id: string; value: string | number | null }[]> {
  return (await run(
    'SELECT external_id, vl_total_planejamento_gastos AS value FROM integration_snapshots WHERE system_id = $1 ORDER BY external_id',
    [systemId],
  )).rows as { external_id: string; value: string | number | null }[];
}

async function seedSnapshot(externalId: string, proposalNumber: string, value: number | null): Promise<void> {
  await run(
    `INSERT INTO integration_snapshots (system_id, external_id, proposal_number, external_status, raw_status, vl_total_planejamento_gastos, payload)
     VALUES ($1, $2, $3, 'APROVADA', 'Aprovada', $4, $5)`,
    [systemId, externalId, proposalNumber, value, JSON.stringify({ seed: externalId })],
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
       VALUES ('transferegov', 'Transferegov (teste P2.2)', 'TRANSFEREGOV_WEBHOOK_SECRET', TRUE, $1)
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

describe('P2.2 — Enriquecimento do snapshot com vl_total_planejamento_gastos', () => {
  it('A. proposta nova: valor da proposta é persistido (vence o campo da parceria)', async () => {
    mockApi({
      parceria: { 1: { body: partnershipEnvelope([partnershipItem('P1', 111)], 1, 1, 1) } },
      proposta: { 1: { body: proposalEnvelope([proposalItem(111, 250000)], 1, 1, 1) } },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.insertedCount).toBe(1);
    expect(result.proposalFetchedCount).toBe(1);
    expect(result.proposalsWithValue).toBe(1);
    expect(result.proposalsWithoutValue).toBe(0);
    expect(result.proposalsEnriched).toBe(1);

    const row = await snapshotValue('P1');
    expect(row?.proposal_number).toBe('111');
    expect(Number(row?.value)).toBe(250000);
  });

  it('B. atualização: proposta existente com valor diferente recebe o novo valor', async () => {
    await seedSnapshot('P1', '111', 100);

    mockApi({
      parceria: { 1: { body: partnershipEnvelope([partnershipItem('P1', 111)], 1, 1, 1) } },
      proposta: { 1: { body: proposalEnvelope([proposalItem(111, 350000)], 1, 1, 1) } },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.updatedCount).toBe(1);
    expect(result.unchangedCount).toBe(0);
    expect(result.proposalsEnriched).toBe(1);

    const row = await snapshotValue('P1');
    expect(Number(row?.value)).toBe(350000);
  });

  it('C. NULL explícito: proposta existente com novo valor null → NULL, não zero e não o valor antigo', async () => {
    await seedSnapshot('P1', '111', 100);

    mockApi({
      parceria: { 1: { body: partnershipEnvelope([partnershipItem('P1', 111)], 1, 1, 1) } },
      proposta: { 1: { body: proposalEnvelope([proposalItem(111, null)], 1, 1, 1) } },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.updatedCount).toBe(1);
    expect(result.proposalsWithoutValue).toBe(1);
    expect(result.proposalsEnriched).toBe(1);

    const row = await snapshotValue('P1');
    expect(row?.value).toBeNull();
  });

  it('D. ausência: proposta existente fora da nova coleta → valor preservado, sem apagar nem zerar', async () => {
    await seedSnapshot('P1', '111', 100);

    // A parceria P1 segue presente (com seu próprio valor); a proposta 111 NÃO
    // aparece na coleta de propostas (vazia). Ausência não vira NULL nem 0.
    mockApi({
      parceria: { 1: { body: partnershipEnvelope([partnershipItem('P1', 111, { vl_total_planejamento_gastos: '100' })], 1, 1, 1) } },
      proposta: { 1: { body: proposalEnvelope([], 1, 0, 1) } },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.proposalsEnriched).toBe(0);

    expect(await countSnapshots()).toBe(1);
    const row = await snapshotValue('P1');
    expect(row?.value).not.toBeNull();
    expect(Number(row?.value)).not.toBe(0);
    expect(Number(row?.value)).toBe(100);
    expect(row?.absent_since).toBeNull();
  });

  it('E. múltiplas páginas: valores de todas as páginas de propostas chegam à persistência', async () => {
    mockApi({
      parceria: {
        1: { body: partnershipEnvelope([partnershipItem('P1', 111), partnershipItem('P2', 222)], 2, 4, 1) },
        2: { body: partnershipEnvelope([partnershipItem('P3', 333), partnershipItem('P4', 444)], 2, 4, 2) },
      },
      proposta: {
        1: { body: proposalEnvelope([proposalItem(111, 100), proposalItem(222, 200)], 2, 4, 1) },
        2: { body: proposalEnvelope([proposalItem(333, 300), proposalItem(444, 400)], 2, 4, 2) },
      },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.executionState).toBe('PUBLISHED');
    expect(result.published).toBe(true);
    expect(result.proposalPagesProcessed).toBe(2);
    expect(result.proposalFetchedCount).toBe(4);
    expect(result.proposalTotalItems).toBe(4);
    expect(result.proposalsEnriched).toBe(4);

    const rows = await listValues();
    expect(rows.map((r) => r.external_id)).toEqual(['P1', 'P2', 'P3', 'P4']);
    const byId = new Map(rows.map((r) => [r.external_id, r.value]));
    expect(Number(byId.get('P1'))).toBe(100);
    expect(Number(byId.get('P2'))).toBe(200);
    expect(Number(byId.get('P3'))).toBe(300);
    expect(Number(byId.get('P4'))).toBe(400);
  });

  it('F. falha durante a coleta de propostas: nenhum snapshot parcial persistido, nenhum UPSERT parcial', async () => {
    await seedSnapshot('P-OLD', '999', 777);

    // Parcerias válidas; propostas: página 1 ok, página 2 falha (500).
    mockApi({
      parceria: { 1: { body: partnershipEnvelope([partnershipItem('P1', 111)], 1, 1, 1) } },
      proposta: {
        1: { body: proposalEnvelope([proposalItem(111, 100)], 2, 2, 1) },
        2: { body: { erro: 'interno' }, status: 500 },
      },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(false);
    expect(result.executionState).toBe('FAILED');
    expect(result.published).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.httpStatus).toBe(500);
    expect(result.error).toContain('Falha na coleta de propostas');
    expect(result.error).toContain('HTTP 500');

    // Nada foi persistido: o registro antigo segue intacto e P1 não foi criado.
    expect(await countSnapshots()).toBe(1);
    const old = await snapshotValue('P-OLD');
    expect(Number(old?.value)).toBe(777);
    expect(old?.absent_since).toBeNull();
    expect(await snapshotValue('P1')).toBeUndefined();
  });

  it('G. idempotência: executar a mesma sincronização duas vezes produz o mesmo estado final', async () => {
    const sync = () =>
      mockApi({
        parceria: { 1: { body: partnershipEnvelope([partnershipItem('P1', 111)], 1, 1, 1) } },
        proposta: { 1: { body: proposalEnvelope([proposalItem(111, 500)], 1, 1, 1) } },
      });

    sync();
    const first = await runTransferegovSnapshotSync(system(), config, {});
    expect(first.published).toBe(true);
    expect(first.insertedCount).toBe(1);
    expect(first.updatedCount).toBe(0);

    sync();
    const second = await runTransferegovSnapshotSync(system(), config, {});
    expect(second.success).toBe(true);
    expect(second.published).toBe(true);
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(0);
    expect(second.unchangedCount).toBe(1);
    expect(second.proposalsEnriched).toBe(1);

    expect(await countSnapshots()).toBe(1);
    const row = await snapshotValue('P1');
    expect(Number(row?.value)).toBe(500);
  });

  it('H. atualização + NULL: transição de valor numérico antigo para NULL', async () => {
    await seedSnapshot('P1', '111', 100);
    await seedSnapshot('P2', '222', 200);

    // P1 transita 100 → NULL; P2 atualiza 200 → 500 na mesma execução.
    mockApi({
      parceria: {
        1: { body: partnershipEnvelope([partnershipItem('P1', 111), partnershipItem('P2', 222)], 1, 2, 1) },
      },
      proposta: {
        1: { body: proposalEnvelope([proposalItem(111, null), proposalItem(222, 500)], 1, 2, 1) },
      },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.updatedCount).toBe(2);
    expect(result.proposalsWithoutValue).toBe(1);
    expect(result.proposalsWithValue).toBe(1);

    const p1 = await snapshotValue('P1');
    expect(p1?.value).toBeNull();

    const p2 = await snapshotValue('P2');
    expect(Number(p2?.value)).toBe(500);
  });

  it('I. integridade por id_proposta: associação por chave, nunca por posição/ordem da resposta', async () => {
    // A ordem das propostas NÃO segue a ordem das parcerias: se a associação
    // fosse por posição, os valores seriam trocados.
    mockApi({
      parceria: {
        1: { body: partnershipEnvelope([partnershipItem('P1', 111), partnershipItem('P2', 222), partnershipItem('P3', 333)], 1, 3, 1) },
      },
      proposta: {
        1: {
          body: proposalEnvelope(
            [proposalItem(333, 333000), proposalItem(111, 111000), proposalItem(222, 222000)],
            1,
            3,
            1,
          ),
        },
      },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.proposalsEnriched).toBe(3);

    const rows = await listValues();
    const byId = new Map(rows.map((r) => [r.external_id, r.value]));
    expect(Number(byId.get('P1'))).toBe(111000);
    expect(Number(byId.get('P2'))).toBe(222000);
    expect(Number(byId.get('P3'))).toBe(333000);
  });

  it('J. regressão: reconciliação existente segue funcionando junto do enriquecimento', async () => {
    await seedSnapshot('A', '111', 10);
    await seedSnapshot('B', '222', 20);

    // Parcerias: apenas A na coleta (B ausente → absent_since). Propostas: A
    // enriquecida com 999. B não deve ser apagado nem zerado.
    mockApi({
      parceria: { 1: { body: partnershipEnvelope([partnershipItem('A', 111)], 1, 1, 1) } },
      proposta: { 1: { body: proposalEnvelope([proposalItem(111, 999)], 1, 1, 1) } },
    });

    const result = await runTransferegovSnapshotSync(system(), config, {});
    expect(result.success).toBe(true);
    expect(result.published).toBe(true);
    expect(result.missingCount).toBe(1);
    expect(result.missingIds).toEqual(['B']);
    expect(result.proposalsEnriched).toBe(1);

    expect(await countSnapshots()).toBe(2);

    const a = await snapshotValue('A');
    expect(Number(a?.value)).toBe(999);
    expect(a?.absent_since).toBeNull();

    const b = await snapshotValue('B');
    expect(b?.absent_since).not.toBeNull();
    expect(Number(b?.value)).toBe(20);
  });
});

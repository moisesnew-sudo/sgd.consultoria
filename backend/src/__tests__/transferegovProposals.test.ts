/**
 * P2.1 — Coleta paginada de propostas do Transferegov (GET /parcerias/proposta).
 *
 * Cobertura A–P:
 *  A  página válida (contrato coerente, success);
 *  B  envelope inválido (sem data array);
 *  C  total_pages inválido;
 *  D  total_items inválido;
 *  E  page_number incoerente;
 *  F  página vazia antes da última;
 *  G  total coletado diferente de total_items;
 *  H  id_proposta ausente;
 *  I  id_proposta duplicado;
 *  J  valor financeiro numérico (number e string numérica);
 *  K  valor financeiro null;
 *  L  valor financeiro inválido;
 *  M  múltiplas páginas;
 *  N  falha HTTP em página intermediária;
 *  O  retry via HttpClient existente;
 *  P  100% dos registros no Map, sem retenção do payload completo.
 *
 * Todos os testes usam fixture pequena e mock determinístico do fetch — sem rede real.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectTransferegovProposals, PARTNERSHIP_BASE_URL } from '../integrations/transferegov.adapter.js';
import type { AdapterConfig } from '../integrations/types.js';

const config: AdapterConfig = {
  baseUrl: PARTNERSHIP_BASE_URL,
  extra: { authType: 'none' },
  maxRetries: 0,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function proposalEnvelope(
  items: unknown[],
  totalPages: number,
  totalItems: number,
  page: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return { data: items, total_pages: totalPages, total_items: totalItems, page_number: page, page_size: 200, ...over };
}

function proposalItem(id: number | string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id_proposta: Number(id), vl_total_planejamento_gastos: 100000, ...over };
}

/** Mocka o fetch global roteando por URL. */
function mockFetch(handler: (url: URL) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input: unknown) =>
    Promise.resolve(handler(new URL(String(input)))),
  );
}

/** Roteia por página: pagina → resposta (sem tocar no endpoint de proposta base). */
function mockProposalPages(responses: Record<number, Response>, other?: Response) {
  return mockFetch((url) => {
    const page = Number(url.searchParams.get('pagina'));
    if (responses[page]) return responses[page];
    if (other) return other;
    return json({ detail: 'Not Found' }, 404);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P2.1 — collectTransferegovProposals', () => {
  it('A. página válida: contrato coerente, success e Map preenchido', async () => {
    const items = [proposalItem(1), proposalItem(2), proposalItem(3)];
    mockProposalPages({ 1: json(proposalEnvelope(items, 1, 3, 1)) });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(true);
    expect(r.pagesProcessed).toBe(1);
    expect(r.totalItems).toBe(3);
    expect(r.fetchedCount).toBe(3);
    expect(r.withValue).toBe(3);
    expect(r.withoutValue).toBe(0);
    expect(r.httpStatus).toBe(200);
    expect(r.error).toBeUndefined();
    expect(r.valuesByProposalId.size).toBe(3);
    expect(r.valuesByProposalId.get('1')).toBe(100000);
  });

  it('B. envelope inválido: sem campo data array → falha de contrato', async () => {
    mockProposalPages({ 1: json({ foo: 'bar' }) });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('envelope');
    expect(r.pagesProcessed).toBe(0);
  });

  it('C. total_pages inválido: inteiro < 1 → falha', async () => {
    mockProposalPages({ 1: json(proposalEnvelope([proposalItem(1)], 0, 1, 1)) });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('total_pages');
  });

  it('C2. total_pages não inteiro → falha', async () => {
    mockProposalPages({ 1: json(proposalEnvelope([proposalItem(1)], 1.5, 1, 1)) });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('total_pages');
  });

  it('D. total_items inválido: negativo → falha', async () => {
    mockProposalPages({ 1: json(proposalEnvelope([proposalItem(1)], 1, -1, 1)) });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('total_items');
  });

  it('E. page_number incoerente com a página solicitada → falha', async () => {
    mockProposalPages({ 1: json(proposalEnvelope([proposalItem(1)], 1, 1, 2)) });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('page_number');
  });

  it('F. página vazia antes da última → falha', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1)], 3, 2, 1)),
      2: json(proposalEnvelope([], 3, 2, 2)),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('vazia');
    expect(r.error).toContain('página 2');
  });

  it('G. total coletado diferente de total_items → falha de incoerência', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1)], 2, 3, 1)),
      2: json(proposalEnvelope([proposalItem(2)], 2, 3, 2)),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('total_items=3');
    expect(r.fetchedCount).toBe(2);
  });

  it('H. id_proposta ausente → falha de contrato', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1), { vl_total_planejamento_gastos: 5000 }], 1, 2, 1)),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('id_proposta');
  });

  it('I. id_proposta duplicado → falha de contrato sem sobrescrever', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1, { vl_total_planejamento_gastos: 100 }), proposalItem(1, { vl_total_planejamento_gastos: 200 })], 1, 2, 1)),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('duplicado');
    expect(r.duplicatedCount).toBe(1);
    expect(r.valuesByProposalId.get('1')).toBe(100);
  });

  it('J. valor financeiro numérico: number e string numérica são armazenados sem escala alterada', async () => {
    const items = [
      proposalItem(1, { vl_total_planejamento_gastos: 400000 }),
      proposalItem(2, { vl_total_planejamento_gastos: '1234.50' }),
    ];
    mockProposalPages({ 1: json(proposalEnvelope(items, 1, 2, 1)) });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(true);
    expect(r.withValue).toBe(2);
    expect(r.withoutValue).toBe(0);
    expect(r.valuesByProposalId.get('1')).toBe(400000);
    expect(r.valuesByProposalId.get('2')).toBe(1234.5);
  });

  it('K. valor financeiro null: armazenado explicitamente como null', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1, { vl_total_planejamento_gastos: null })], 1, 1, 1)),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(true);
    expect(r.withValue).toBe(0);
    expect(r.withoutValue).toBe(1);
    expect(r.valuesByProposalId.get('1')).toBeNull();
    expect(r.valuesByProposalId.has('1')).toBe(true);
  });

  it('L. valor financeiro inválido: string não numérica → falha, sem conversão silenciosa', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1, { vl_total_planejamento_gastos: 'abc' })], 1, 1, 1)),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('vl_total_planejamento_gastos inválido');
    expect(r.invalidValueCount).toBe(1);
    expect(r.valuesByProposalId.has('1')).toBe(false);
  });

  it('M. múltiplas páginas: segue total_pages e acumula o Map', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1), proposalItem(2)], 3, 5, 1)),
      2: json(proposalEnvelope([proposalItem(3), proposalItem(4)], 3, 5, 2)),
      3: json(proposalEnvelope([proposalItem(5)], 3, 5, 3)),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(true);
    expect(r.pagesProcessed).toBe(3);
    expect(r.fetchedCount).toBe(5);
    expect(r.totalItems).toBe(5);
    expect(r.valuesByProposalId.size).toBe(5);
    expect(r.valuesByProposalId.has('5')).toBe(true);
  });

  it('N. falha HTTP em página intermediária → coleta incompleta não é sucesso', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1)], 3, 3, 1)),
      2: json({ detail: 'erro' }, 500),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.httpStatus).toBe(500);
    expect(r.error).toContain('HTTP 500');
    expect(r.pagesProcessed).toBe(1);
    expect(r.fetchedCount).toBe(1);
  });

  it('O. retry delegado ao HttpClient: 500 seguido de 200 na mesma página', async () => {
    let attempts = 0;
    mockFetch((url) => {
      if (url.searchParams.get('pagina') === '1') {
        attempts++;
        return attempts === 1 ? json({ detail: 'temporário' }, 500) : json(proposalEnvelope([proposalItem(1)], 1, 1, 1));
      }
      return json({ detail: 'Not Found' }, 404);
    });

    const r = await collectTransferegovProposals({ ...config, maxRetries: 1 });
    expect(r.success).toBe(true);
    expect(attempts).toBe(2);
    expect(r.fetchedCount).toBe(1);
  });

  it('P. 100% dos registros convertidos ao Map, sem retenção do payload completo', async () => {
    mockProposalPages({
      1: json(proposalEnvelope([proposalItem(1, { ds_objeto: 'x'.repeat(500) }), proposalItem(2)], 2, 3, 1)),
      2: json(proposalEnvelope([proposalItem(3)], 2, 3, 2)),
    });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(true);
    expect(r.valuesByProposalId.size).toBe(3);
    expect(r.fetchedCount).toBe(3);
    expect(r.totalItems).toBe(3);

    // O resultado deve conter apenas a estrutura mínima — nenhum payload/registro bruto.
    const keys = Object.keys(r);
    expect(keys).toEqual(expect.arrayContaining([
      'valuesByProposalId', 'pagesProcessed', 'totalItems', 'fetchedCount',
      'withValue', 'withoutValue', 'httpStatus', 'durationMs', 'duplicatedCount', 'invalidValueCount', 'success',
    ]));
    expect((r as unknown as { items?: unknown }).items).toBeUndefined();
    expect((r as unknown as { records?: unknown }).records).toBeUndefined();
  });

  it('Q. page_size fora do intervalo 1..200 → falha de contrato', async () => {
    mockProposalPages({ 1: json(proposalEnvelope([proposalItem(1)], 1, 1, 1, { page_size: 500 })) });

    const r = await collectTransferegovProposals(config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('page_size');
  });
});

/**
 * A7.2 — Contrato real da API Pública de Gestão de Parcerias (Transferegov).
 *
 * Valida o comportamento do adapter governamental contra o contrato real:
 * - Base URL oficial e autenticação authType=none (sem credencial);
 * - Endpoint GET /parcerias/parceria com pagina e tamanho_da_pagina;
 * - Paginação até total_pages com coerência de total_items;
 * - Identidade via cd_parceria (nu_externo NÃO é identificador);
 * - Status dos 8 estados reais (normalização determinística, acentos);
 * - Financeiro via vl_total_planejamento_gastos (nr_vlr_total não é usado);
 * - Preservação dos campos externos no payload;
 * - Erros: 404, 422, 500, timeout, JSON inválido, resposta estruturalmente inválida.
 *
 * Todos os testes usam mock determinístico do fetch global — sem rede real.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  transferegovGovAdapter,
  PARTNERSHIP_BASE_URL,
} from '../integrations/transferegov.adapter.js';

const OFFICIAL_BASE = PARTNERSHIP_BASE_URL;

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function partnershipEnvelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: [],
    total_pages: 1,
    total_items: 0,
    page_number: 1,
    page_size: 200,
    ...over,
  };
}

/** Registro de parceria real (padrão observado no censo de produção). */
function realPartnership(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id_parceria: 3809,
    cd_parceria: '202500037062',
    id_proposta: 37916,
    nu_externo: '12345',
    in_situacao_parceria: 'Aprovada',
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Configuração do contrato
// ---------------------------------------------------------------------------
describe('A7.2 — Configuração do contrato (base oficial, authType=none)', () => {
  it('base URL oficial da API Pública de Gestão de Parcerias', () => {
    expect(PARTNERSHIP_BASE_URL).toBe('https://api-publica.transferegov.gestao.gov.br/parcerias');
  });

  it('authenticate com authType=none não lê secret nem exige credencial', async () => {
    process.env.TRANSFEREGOV_PARTNERSHIP_SECRET = 'secret-que-nao-deve-ser-usado';
    try {
      const credential = await transferegovGovAdapter.authenticate({
        baseUrl: OFFICIAL_BASE,
        secretEnvKey: 'TRANSFEREGOV_PARTNERSHIP_SECRET',
        extra: { authType: 'none' },
      });
      expect(credential).toBeNull();
    } finally {
      delete process.env.TRANSFEREGOV_PARTNERSHIP_SECRET;
    }
  });

  it('authenticate com authType omitido usa none (API pública)', async () => {
    process.env.TRANSFEREGOV_PARTNERSHIP_SECRET = 'secret-que-nao-deve-ser-usado';
    try {
      const credential = await transferegovGovAdapter.authenticate({
        baseUrl: OFFICIAL_BASE,
        secretEnvKey: 'TRANSFEREGOV_PARTNERSHIP_SECRET',
      });
      expect(credential).toBeNull();
    } finally {
      delete process.env.TRANSFEREGOV_PARTNERSHIP_SECRET;
    }
  });

  it('fetch sem credencial não envia Authorization nem X-API-Key', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(partnershipEnvelope()));

    await transferegovGovAdapter.fetch({ baseUrl: OFFICIAL_BASE, extra: { authType: 'none' } }, null, {});

    const [, init] = mockFetch.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['X-API-Key']).toBeUndefined();
    expect(headers['X-Api-Key']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Endpoint e parâmetros
// ---------------------------------------------------------------------------
describe('A7.2 — Endpoint e parâmetros (GET /parcerias/parceria)', () => {
  it('fetch com base oficial chama /parcerias/parceria com pagina=1 e tamanho_da_pagina=200', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(partnershipEnvelope()));

    const result = await transferegovGovAdapter.fetch({ baseUrl: OFFICIAL_BASE }, null, {});

    expect(result.status).toBe(200);
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(
      'https://api-publica.transferegov.gestao.gov.br/parcerias/parceria?pagina=1&tamanho_da_pagina=200'
    );
  });

  it('fetch com base sem sufixo /parcerias constrói a URL canônica', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(partnershipEnvelope()));

    await transferegovGovAdapter.fetch(
      { baseUrl: 'https://api-publica.transferegov.gestao.gov.br' },
      null,
      {}
    );

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(
      'https://api-publica.transferegov.gestao.gov.br/parcerias/parceria?pagina=1&tamanho_da_pagina=200'
    );
  });

  it('fetch respeita pagina e tamanho_da_pagina informados', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(partnershipEnvelope()));

    await transferegovGovAdapter.fetch({ baseUrl: OFFICIAL_BASE }, null, {
      pagina: 3,
      tamanho_da_pagina: 150,
    });

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('pagina=3');
    expect(String(url)).toContain('tamanho_da_pagina=150');
  });

  it('fetch limita tamanho_da_pagina a no máximo 200', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(partnershipEnvelope()));

    await transferegovGovAdapter.fetch({ baseUrl: OFFICIAL_BASE }, null, {
      pagina: 1,
      tamanho_da_pagina: 500,
    });

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('tamanho_da_pagina=200');
  });

  it('fetch com baseUrl ausente retorna status 0', async () => {
    const result = await transferegovGovAdapter.fetch({}, null, {});
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Paginação (sync)
// ---------------------------------------------------------------------------
describe('A7.2 — Paginação (pagina → total_pages)', () => {
  it('percorre todas as páginas, para em total_pages e soma corretamente', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const page = Number(new URL(String(url)).searchParams.get('pagina'));
      const data = page === 1
        ? [realPartnership({ cd_parceria: '202600000001' }), realPartnership({ cd_parceria: '202600000002' })]
        : [realPartnership({ cd_parceria: '202600000003' }), realPartnership({ cd_parceria: '202600000004' })];
      return Promise.resolve(mockJsonResponse(partnershipEnvelope({ data, total_pages: 2, total_items: 4, page_number: page })));
    });

    const result = await transferegovGovAdapter.sync({ baseUrl: OFFICIAL_BASE }, {});

    expect(result.success).toBe(true);
    expect(result.fetchedCount).toBe(4);
    expect(result.normalizedCount).toBe(4);
    expect(result.events.length).toBe(4);

    // Chamadas: uma por página, sem chamada além de total_pages.
    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls.length).toBe(2);
    expect(urls[0]).toContain('pagina=1');
    expect(urls[1]).toContain('pagina=2');
    expect(urls.some((u) => u.includes('pagina=3'))).toBe(false);
  });

  it('página única não dispara chamadas adicionais', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse(partnershipEnvelope({ data: [realPartnership()], total_pages: 1, total_items: 1 }))
    );

    const result = await transferegovGovAdapter.sync({ baseUrl: OFFICIAL_BASE }, {});

    expect(result.success).toBe(true);
    expect(result.fetchedCount).toBe(1);
    expect(mockFetch.mock.calls.length).toBe(1);
  });

  it('detecta incoerência com total_items (total obtido diferente)', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse(partnershipEnvelope({ data: [realPartnership()], total_pages: 1, total_items: 5 }))
    );

    const result = await transferegovGovAdapter.sync({ baseUrl: OFFICIAL_BASE }, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Incoerência de paginação');
    expect(result.error).toContain('total_items=5');
    expect(mockFetch.mock.calls.length).toBe(1);
  });

  it('maxRecords limita a quantidade obtida e não exige coerência de total_items', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const page = Number(new URL(String(url)).searchParams.get('pagina'));
      const data = page === 1
        ? [realPartnership({ cd_parceria: '202600000001' }), realPartnership({ cd_parceria: '202600000002' })]
        : [realPartnership({ cd_parceria: '202600000003' })];
      return Promise.resolve(mockJsonResponse(partnershipEnvelope({ data, total_pages: 2, total_items: 3, page_number: page })));
    });

    const result = await transferegovGovAdapter.sync({ baseUrl: OFFICIAL_BASE }, { maxRecords: 2 });

    expect(result.success).toBe(true);
    expect(result.fetchedCount).toBe(2);
    expect(result.events.length).toBe(2);
    expect(mockFetch.mock.calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Identidade (cd_parceria → externalId)
// ---------------------------------------------------------------------------
describe('A7.2 — Identidade (external_id = cd_parceria)', () => {
  it('normaliza cd_parceria como externalId e preserva os campos reais', () => {
    const evt = transferegovGovAdapter.normalize(realPartnership());

    expect(evt.externalId).toBe('202500037062');
    expect(evt.proposalNumber).toBe('37916');
    expect(evt.externalStatus).toBe('APROVADA');
    expect(evt.extra?.idParceria).toBe('3809');
    expect(evt.extra?.idProposta).toBe('37916');
    expect(evt.extra?.cdParceria).toBe('202500037062');
    expect(evt.extra?.nuExterno).toBe('12345');
    expect(evt.extra?.rawStatus).toBe('Aprovada');
  });

  it('nu_externo NÃO é usado como externalId', () => {
    const evt = transferegovGovAdapter.normalize({
      id_proposta: 42,
      nu_externo: 'EXT-1',
      in_situacao_parceria: 'Em Análise',
    });
    expect(evt.externalId).toBeUndefined();
    expect(evt.extra?.nuExterno).toBe('EXT-1');
  });
});

// ---------------------------------------------------------------------------
// 5. Status (8 estados reais)
// ---------------------------------------------------------------------------
describe('A7.2 — Status (8 estados reais normalizados)', () => {
  const REAL_STATUSES: Array<[string, string]> = [
    ['Aprovada', 'APROVADA'],
    ['Em Análise', 'EM_ANALISE'],
    ['Em Elaboração', 'EM_ELABORACAO'],
    ['Rejeitada', 'REJEITADA'],
    ['Em Captação', 'EM_CAPTACAO'],
    ['Em Execução', 'EM_EXECUCAO'],
    ['Inativa', 'INATIVA'],
    ['Assinada', 'ASSINADA'],
  ];

  it.each(REAL_STATUSES)('normaliza %s → %s', (raw, expected) => {
    const evt = transferegovGovAdapter.normalize(
      realPartnership({ in_situacao_parceria: raw })
    );
    expect(evt.externalStatus).toBe(expected);
  });

  it('remove acentos e normaliza espaços de forma determinística', () => {
    expect(transferegovGovAdapter.normalize(
      realPartnership({ in_situacao_parceria: 'em análise' })
    ).externalStatus).toBe('EM_ANALISE');
    expect(transferegovGovAdapter.normalize(
      realPartnership({ in_situacao_parceria: 'EM ELABORAÇÃO' })
    ).externalStatus).toBe('EM_ELABORACAO');
  });

  it('preserva o status original (com acentos) no payload', () => {
    const evt = transferegovGovAdapter.normalize(
      realPartnership({ in_situacao_parceria: 'Em Análise' })
    );
    expect(evt.extra?.rawStatus).toBe('Em Análise');
  });
});

// ---------------------------------------------------------------------------
// 6. Financeiro (vl_total_planejamento_gastos)
// ---------------------------------------------------------------------------
describe('A7.2 — Financeiro (vl_total_planejamento_gastos)', () => {
  it('preserva o valor original de vl_total_planejamento_gastos', () => {
    const evt = transferegovGovAdapter.normalize(
      realPartnership({ vl_total_planejamento_gastos: 200000.0 })
    );
    expect(evt.extra?.vlTotalPlanejamentoGastos).toBe(200000.0);
  });

  it('nr_vlr_total não é usado como fonte financeira', () => {
    const evt = transferegovGovAdapter.normalize(
      realPartnership({
        vl_total_planejamento_gastos: 200000.0,
        nr_vlr_total: 999999.0,
      })
    );
    expect(evt.extra?.vlTotalPlanejamentoGastos).toBe(200000.0);
  });

  it('com apenas nr_vlr_total, nenhum valor financeiro é extraído', () => {
    const evt = transferegovGovAdapter.normalize(
      realPartnership({ nr_vlr_total: 999999.0 })
    );
    expect(evt.extra?.vlTotalPlanejamentoGastos).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Payload — preservação dos campos externos
// ---------------------------------------------------------------------------
describe('A7.2 — Payload (preservação de campos externos)', () => {
  it('preserva id_parceria, id_proposta, cd_parceria e nu_externo', () => {
    const evt = transferegovGovAdapter.normalize(
      realPartnership({ id_parceria: 3809, id_proposta: 37916, cd_parceria: '202500037062', nu_externo: '12345' })
    );
    expect(evt.extra).toMatchObject({
      idParceria: '3809',
      idProposta: '37916',
      cdParceria: '202500037062',
      nuExterno: '12345',
    });
  });

  it('validate aceita parceria real (cd_parceria + in_situacao_parceria)', () => {
    expect(transferegovGovAdapter.validate(realPartnership())).toBe(true);
  });

  it('validate aceita id_parceria ou id_proposta como identificador', () => {
    expect(transferegovGovAdapter.validate({ id_parceria: 7, in_situacao_parceria: 'Inativa' })).toBe(true);
    expect(transferegovGovAdapter.validate({ id_proposta: 9, in_situacao_parceria: 'Assinada' })).toBe(true);
  });

  it('validate mantém compatibilidade com proposta/convênio legados', () => {
    expect(transferegovGovAdapter.validate({ numero_proposta: 'PROP-1', status: 'APROVADO' })).toBe(true);
    expect(transferegovGovAdapter.validate({ numero_convenio: 'CONV-1' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Erros externos
// ---------------------------------------------------------------------------
describe('A7.2 — Erros externos', () => {
  it.each([404, 422])('HTTP %d retorna falha estruturada sem authError', async (status) => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Erro', { status })
    );

    const result = await transferegovGovAdapter.sync({ baseUrl: OFFICIAL_BASE }, {});

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(status);
    expect(result.authError).toBe(false);
    expect(result.error).toContain(`HTTP ${status}`);
    expect(result.events).toEqual([]);
  });

  it('HTTP 500 com maxRetries=0 retorna falha estruturada', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 })
    );

    const result = await transferegovGovAdapter.sync(
      { baseUrl: OFFICIAL_BASE, maxRetries: 0 },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(500);
    expect(result.authError).toBe(false);
  });

  it('timeout (rede) com maxRetries=0 retorna falha com httpStatus 0', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError')
    );

    const result = await transferegovGovAdapter.sync(
      { baseUrl: OFFICIAL_BASE, maxRetries: 0 },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.error).toContain('rede');
  });

  it('JSON inválido é tratado como resposta estruturalmente inválida', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('isso-não-é-json', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const result = await transferegovGovAdapter.sync({ baseUrl: OFFICIAL_BASE }, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('estruturalmente inválida');
  });

  it('envelope sem campo data (array) é estruturalmente inválido', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse(partnershipEnvelope({ data: 'nao-e-array' }))
    );

    const result = await transferegovGovAdapter.sync({ baseUrl: OFFICIAL_BASE }, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('estruturalmente inválida');
  });

  it('envelope sem total_pages/total_items é estruturalmente inválido', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: [] })
    );

    const result = await transferegovGovAdapter.sync({ baseUrl: OFFICIAL_BASE }, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('total_pages e total_items');
  });

  it('sync sem baseUrl é erro de configuração (httpStatus 0), não transitório', async () => {
    const result = await transferegovGovAdapter.sync({}, {});

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.error).toContain('BaseUrl não configurada');
    expect(result.events).toEqual([]);
  });
});

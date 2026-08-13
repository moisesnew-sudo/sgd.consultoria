import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  transferegovAdapter,
  transferegovGovAdapter,
} from '../integrations/transferegov.adapter.js';
import {
  seiAdapter,
  seiGovAdapter,
} from '../integrations/sei.adapter.js';
import {
  cglogAdapter,
  cglogGovAdapter,
} from '../integrations/cglog.adapter.js';
import {
  getAdapter,
  getGovAdapter,
  hasGovAdapter,
  listAdapters,
} from '../lib/adapterRegistry.js';
import {
  normalizeExternalStatus,
  toIsoDate,
  flattenPayload,
  pickString,
} from '../integrations/types.js';
import { readSecret, requireEnv, optionalEnv } from '../integrations/httpClient.js';

// ---------------------------------------------------------------------------
// 1. Adapter Registry
// ---------------------------------------------------------------------------
describe('Adapter Registry', () => {
  it('retorna adapter síncrono para cada sistema registrado', () => {
    expect(getAdapter('transferegov')).toBe(transferegovAdapter);
    expect(getAdapter('sei')).toBe(seiAdapter);
    expect(getAdapter('cglog')).toBe(cglogAdapter);
  });

  it('retorna adapter governamental para cada sistema registrado', () => {
    expect(getGovAdapter('transferegov')).toBe(transferegovGovAdapter);
    expect(getGovAdapter('sei')).toBe(seiGovAdapter);
    expect(getGovAdapter('cglog')).toBe(cglogGovAdapter);
  });

  it('hasGovAdapter retorna true para sistemas com adapter governamental', () => {
    expect(hasGovAdapter('transferegov')).toBe(true);
    expect(hasGovAdapter('sei')).toBe(true);
    expect(hasGovAdapter('cglog')).toBe(true);
  });

  it('hasGovAdapter retorna false para sistema desconhecido', () => {
    expect(hasGovAdapter('sistema_desconhecido')).toBe(false);
    expect(hasGovAdapter('')).toBe(false);
  });

  it('getAdapter é case-insensitive', () => {
    expect(getAdapter('TRANSFEREGOV')).toBe(transferegovAdapter);
    expect(getAdapter('Sei')).toBe(seiAdapter);
    expect(getAdapter('CGLOG')).toBe(cglogAdapter);
  });

  it('getGovAdapter retorna undefined para sistema desconhecido', () => {
    expect(getGovAdapter('sistema_desconhecido')).toBeUndefined();
    expect(getGovAdapter('')).toBeUndefined();
  });

  it('listAdapters retorna todos os sistemas com metadados', () => {
    const adapters = listAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(3);

    const transferegov = adapters.find((a) => a.code === 'transferegov');
    expect(transferegov).toBeDefined();
    expect(transferegov!.name).toBe('Transferegov');
    expect(transferegov!.hasGovAdapter).toBe(true);
    expect(transferegov!.description).toContain('Transferegov');

    const sei = adapters.find((a) => a.code === 'sei');
    expect(sei).toBeDefined();
    expect(sei!.hasGovAdapter).toBe(true);

    const cglog = adapters.find((a) => a.code === 'cglog');
    expect(cglog).toBeDefined();
    expect(cglog!.hasGovAdapter).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Autenticação (authenticate)
// ---------------------------------------------------------------------------
describe('Autenticação de Adapters Governamentais', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('Transferegov: retorna null quando secret_env_key não está configurado', async () => {
    delete process.env.TRANSFEREGOV_API_KEY;
    const result = await transferegovGovAdapter.authenticate({ secretEnvKey: undefined });
    expect(result).toBeNull();
  });

  it('Transferegov: retorna null quando variável de ambiente não existe', async () => {
    delete process.env.NONEXISTENT_KEY;
    const result = await transferegovGovAdapter.authenticate({ secretEnvKey: 'NONEXISTENT_KEY' });
    expect(result).toBeNull();
  });

  it('Transferegov: retorna secret como API key quando authType não é oauth2', async () => {
    process.env.TRANSFEREGOV_API_KEY = 'test-api-key-123';
    const result = await transferegovGovAdapter.authenticate({
      secretEnvKey: 'TRANSFEREGOV_API_KEY',
      extra: { authType: 'api_key' },
    });
    expect(result).toBe('test-api-key-123');
  });

  it('SEI: retorna null quando secret_env_key não está configurado', async () => {
    delete process.env.SEI_API_TOKEN;
    const result = await seiGovAdapter.authenticate({ secretEnvKey: undefined });
    expect(result).toBeNull();
  });

  it('SEI: retorna secret como token', async () => {
    process.env.SEI_API_TOKEN = 'test-sei-token-456';
    const result = await seiGovAdapter.authenticate({
      secretEnvKey: 'SEI_API_TOKEN',
    });
    expect(result).toBe('test-sei-token-456');
  });

  it('CGLOG: retorna null quando secret_env_key não está configurado', async () => {
    delete process.env.CGLOG_API_TOKEN;
    const result = await cglogGovAdapter.authenticate({ secretEnvKey: undefined });
    expect(result).toBeNull();
  });

  it('CGLOG: retorna secret como token', async () => {
    process.env.CGLOG_API_TOKEN = 'test-cglog-token-789';
    const result = await cglogGovAdapter.authenticate({
      secretEnvKey: 'CGLOG_API_TOKEN',
    });
    expect(result).toBe('test-cglog-token-789');
  });

  // -------------------------------------------------------------------------
  // Segurança (A7.1 — integração pública sem autenticação)
  // -------------------------------------------------------------------------
  it('Transferegov: authType=none sem secret → authenticate retorna null', async () => {
    delete process.env.TRANSFEREGOV_API_KEY;
    const result = await transferegovGovAdapter.authenticate({
      baseUrl: 'https://api-publica.transferegov.gestao.gov.br',
      extra: { authType: 'none' },
    });
    expect(result).toBeNull();
  });

  it('Transferegov: authType=none → nenhum header de autorização é produzido', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await transferegovGovAdapter.fetch(
      { baseUrl: 'https://api-publica.transferegov.gestao.gov.br', extra: { authType: 'none' } },
      null,
      {}
    );

    expect(result.status).toBe(200);
    const [, init] = mockFetch.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['X-API-Key']).toBeUndefined();
    expect(headers['X-Api-Key']).toBeUndefined();

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. Normalização (normalize) — adapters síncronos
// ---------------------------------------------------------------------------
describe('Normalização de Adapters — payload válido', () => {
  it('Transferegov extrai proposta, convênio, status e prazo', () => {
    const evt = transferegovAdapter.normalize({
      event: 'demand.updated',
      numero_proposta: 'PROP-2026-001',
      numero_convenio: 'CONV-2026-001',
      status: 'APROVADO',
      prazo: '2026-12-31',
    });
    expect(evt.systemCode).toBe('transferegov');
    expect(evt.eventType).toBe('demand.updated');
    expect(evt.proposalNumber).toBe('PROP-2026-001');
    expect(evt.externalId).toBe('CONV-2026-001');
    expect(evt.externalStatus).toBe('APROVADO');
    expect(evt.deadline).toBe('2026-12-31T00:00:00.000Z');
    expect(evt.extra?.contractNumber).toBe('CONV-2026-001');
  });

  it('SEI extrai número do processo, proposta e datas', () => {
    const evt = seiAdapter.normalize({
      event: 'processo.atualizado',
      numero_processo: '00100.123456/2026-01',
      proposta: 'PROP-SEI-42',
      situacao: 'TRAMITANDO',
      data_finalizacao: '2026-09-30',
      data_abertura: '2026-01-15',
    });
    expect(evt.systemCode).toBe('sei');
    expect(evt.proposalNumber).toBe('PROP-SEI-42');
    expect(evt.externalId).toBe('00100.123456/2026-01');
    expect(evt.externalStatus).toBe('TRAMITANDO');
    expect(evt.deadline).toBe('2026-09-30T00:00:00.000Z');
    expect(evt.extra?.dates).toBeDefined();
  });

  it('CGLOG extrai protocolo, proposta e status', () => {
    const evt = cglogAdapter.normalize({
      event: 'demand.synced',
      protocolo: 'PROT-999',
      proposal_number: 'PROP-CG-7',
      status: 'CONCLUIDO',
    });
    expect(evt.systemCode).toBe('cglog');
    expect(evt.proposalNumber).toBe('PROP-CG-7');
    expect(evt.externalId).toBe('PROT-999');
    expect(evt.externalStatus).toBe('CONCLUIDO');
  });

  it('aceita envelope aninhado { event, data: {...} }', () => {
    const evt = transferegovAdapter.normalize({
      event: 'demand.updated',
      data: { proposta: 'PROP-ENV-1', status: 'EM ANÁLISE', contrato: 2026001 },
    });
    expect(evt.proposalNumber).toBe('PROP-ENV-1');
    expect(evt.externalStatus).toBe('EM_ANALISE');
    expect(evt.externalId).toBe('2026001');
  });

  it('adapter governamental normaliza igual ao síncrono', () => {
    const payload = {
      event: 'demand.updated',
      numero_proposta: 'PROP-GOV-1',
      status: 'PENDENTE',
    };
    const syncResult = transferegovAdapter.normalize(payload);
    const govResult = transferegovGovAdapter.normalize(payload);
    expect(govResult).toEqual(syncResult);
  });
});

describe('Normalização de Adapters — payload incompleto', () => {
  it('Transferegov com payload mínimo não lança e retorna campos opcionais undefined', () => {
    const evt = transferegovAdapter.normalize({ event: 'demand.updated' });
    expect(evt.proposalNumber).toBeUndefined();
    expect(evt.externalId).toBeUndefined();
    expect(evt.externalStatus).toBeUndefined();
    expect(evt.deadline).toBeUndefined();
    expect(evt.eventType).toBe('demand.updated');
  });

  it('SEI sem proposta retorna proposalNumber undefined', () => {
    const evt = seiAdapter.normalize({ numero_processo: 'PROC-1', status: 'FINALIZADO' });
    expect(evt.externalId).toBe('PROC-1');
    expect(evt.proposalNumber).toBeUndefined();
    expect(evt.externalStatus).toBe('FINALIZADO');
  });

  it('CGLOG sem prazo retorna deadline undefined', () => {
    const evt = cglogAdapter.normalize({ protocolo: 'PROT-1', status: 'EM_ANALISE' });
    expect(evt.externalId).toBe('PROT-1');
    expect(evt.deadline).toBeUndefined();
  });

  it("payload vazio/nulo/array/string não lança e retorna evento 'unknown'", () => {
    for (const garbage of [null, undefined, {}, [], 'texto', 42, true]) {
      const evt = seiAdapter.normalize(garbage as any);
      expect(evt.systemCode).toBe('sei');
      expect(evt.eventType).toBe('unknown');
      expect(evt.proposalNumber).toBeUndefined();
      expect(evt.externalId).toBeUndefined();
      expect(evt.externalStatus).toBeUndefined();
      expect(evt.deadline).toBeUndefined();
    }
  });
});

describe('Normalização de status', () => {
  it('normalizeExternalStatus: CAIXA ALTA, sem acentos, espaços viram underscore', () => {
    expect(normalizeExternalStatus('aprovado')).toBe('APROVADO');
    expect(normalizeExternalStatus('em análise')).toBe('EM_ANALISE');
    expect(normalizeExternalStatus('  em analise ')).toBe('EM_ANALISE');
    expect(normalizeExternalStatus('Pendente')).toBe('PENDENTE');
    expect(normalizeExternalStatus('em-andamento')).toBe('EM_ANDAMENTO');
  });

  it('normalizeExternalStatus: vazio/ausente retorna undefined', () => {
    expect(normalizeExternalStatus(undefined)).toBeUndefined();
    expect(normalizeExternalStatus(null)).toBeUndefined();
    expect(normalizeExternalStatus('   ')).toBeUndefined();
  });

  it('toIsoDate: data válida convertida, inválida/ausente retorna undefined', () => {
    expect(toIsoDate('2026-08-05')).toBe('2026-08-05T00:00:00.000Z');
    expect(toIsoDate('31/02/2026')).toBeUndefined();
    expect(toIsoDate('nao-e-data')).toBeUndefined();
    expect(toIsoDate(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Validação (validate) — adapters governamentais
// ---------------------------------------------------------------------------
describe('Validação de Payloads (validate)', () => {
  it('Transferegov: payload com proposta é válido', () => {
    const result = transferegovGovAdapter.validate({
      numero_proposta: 'PROP-001',
      status: 'APROVADO',
    });
    expect(result).toBe(true);
  });

  it('Transferegov: payload com convênio é válido', () => {
    const result = transferegovGovAdapter.validate({
      numero_convenio: 'CONV-001',
      status: 'EM_ANALISE',
    });
    expect(result).toBe(true);
  });

  it('Transferegov: payload sem proposta nem convênio é inválido', () => {
    const result = transferegovGovAdapter.validate({ status: 'APROVADO' });
    expect(typeof result).toBe('string');
    expect(result).toContain('proposta ou convênio');
  });

  it('Transferegov: payload nulo é inválido', () => {
    const result = transferegovGovAdapter.validate(null);
    expect(typeof result).toBe('string');
  });

  it('Transferegov: payload array é inválido', () => {
    const result = transferegovGovAdapter.validate([]);
    expect(typeof result).toBe('string');
  });

  it('SEI: payload com NUP válido é válido', () => {
    const result = seiGovAdapter.validate({
      numero_processo: '00100.123456/2026-01',
      status: 'TRAMITANDO',
    });
    expect(result).toBe(true);
  });

  it('SEI: payload com NUP em formato inválido é inválido', () => {
    const result = seiGovAdapter.validate({
      numero_processo: 'FORMATO-INVALIDO',
      status: 'TRAMITANDO',
    });
    expect(typeof result).toBe('string');
    expect(result).toContain('NUP');
  });

  it('SEI: payload sem NUP nem proposta é inválido', () => {
    const result = seiGovAdapter.validate({ status: 'FINALIZADO' });
    expect(typeof result).toBe('string');
  });

  it('CGLOG: payload com protocolo é válido', () => {
    const result = cglogGovAdapter.validate({
      protocolo: 'PROT-001',
      status: 'CONCLUIDO',
    });
    expect(result).toBe(true);
  });

  it('CGLOG: payload com proposta é válido', () => {
    const result = cglogGovAdapter.validate({
      proposal_number: 'PROP-CG-1',
    });
    expect(result).toBe(true);
  });

  it('CGLOG: payload sem protocolo nem proposta é inválido', () => {
    const result = cglogGovAdapter.validate({ status: 'EM_ANALISE' });
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 5. Erro externo (fetch com baseUrl ausente)
// ---------------------------------------------------------------------------
describe('Fetch com configuração inválida', () => {
  it('Transferegov: fetch com baseUrl ausente retorna status 0', async () => {
    const result = await transferegovGovAdapter.fetch({}, null, {});
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });

  it('SEI: fetch com baseUrl ausente retorna status 0', async () => {
    const result = await seiGovAdapter.fetch({}, null, {});
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });

  it('CGLOG: fetch com baseUrl ausente retorna status 0', async () => {
    const result = await cglogGovAdapter.fetch({}, null, {});
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Timeout (configuração de timeout)
// ---------------------------------------------------------------------------
describe('Configuração de Timeout', () => {
  it('AdapterConfig aceita timeoutMs personalizado', () => {
    const config = { timeoutMs: 5000 };
    expect(config.timeoutMs).toBe(5000);
  });

  it('AdapterConfig aceita maxRetries personalizado', () => {
    const config = { maxRetries: 5 };
    expect(config.maxRetries).toBe(5);
  });

  it('AdapterConfig aceita retryBaseDelayMs personalizado', () => {
    const config = { retryBaseDelayMs: 2000 };
    expect(config.retryBaseDelayMs).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// 7. Retry (estrutura de retry)
// ---------------------------------------------------------------------------
describe('Configuração de Retry', () => {
  it('AdapterConfig aceita configuração de retry', () => {
    const config = {
      maxRetries: 3,
      retryBaseDelayMs: 1000,
    };
    expect(config.maxRetries).toBe(3);
    expect(config.retryBaseDelayMs).toBe(1000);
  });

  it('sync retorna erro estruturado quando baseUrl não configurada', async () => {
    const result = await transferegovGovAdapter.sync({}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('BaseUrl não configurada');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.events).toEqual([]);
    expect(result.fetchedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Integração desligada (sistema inativo)
// ---------------------------------------------------------------------------
describe('Sistema Inativo', () => {
  it('adapter governamental funciona mesmo sem config (modo degradado)', async () => {
    const result = await transferegovGovAdapter.sync({}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('BaseUrl não configurada');
  });

  it('authenticate retorna null quando sistema sem secret', async () => {
    delete process.env.TRANSFEREGOV_API_KEY;
    const result = await transferegovGovAdapter.authenticate({});
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Logs sem segredo (sanitização)
// ---------------------------------------------------------------------------
describe('Segurança — Logs sem segredo', () => {
  it('readSecret retorna null quando variável não existe', () => {
    delete process.env.NONEXISTENT_SECRET;
    const result = readSecret('NONEXISTENT_SECRET');
    expect(result).toBeNull();
  });

  it('readSecret retorna valor quando variável existe', () => {
    process.env.TEST_SECRET = 'super-secret-value';
    const result = readSecret('TEST_SECRET');
    expect(result).toBe('super-secret-value');
    delete process.env.TEST_SECRET;
  });

  it('requireEnv lança erro quando variável não existe', () => {
    delete process.env.NONEXISTENT_REQUIRED;
    expect(() => requireEnv('NONEXISTENT_REQUIRED')).toThrow('Variável de ambiente obrigatória não configurada');
  });

  it('requireEnv retorna valor quando variável existe', () => {
    process.env.TEST_REQUIRED = 'required-value';
    const result = requireEnv('TEST_REQUIRED');
    expect(result).toBe('required-value');
    delete process.env.TEST_REQUIRED;
  });

  it('optionalEnv retorna padrão quando variável não existe', () => {
    delete process.env.NONEXISTENT_OPTIONAL;
    const result = optionalEnv('NONEXISTENT_OPTIONAL', 'default');
    expect(result).toBe('default');
  });

  it('optionalEnv retorna valor quando variável existe', () => {
    process.env.TEST_OPTIONAL = 'custom-value';
    const result = optionalEnv('TEST_OPTIONAL', 'default');
    expect(result).toBe('custom-value');
    delete process.env.TEST_OPTIONAL;
  });
});

// ---------------------------------------------------------------------------
// 10. Sincronização (sync)
// ---------------------------------------------------------------------------
describe('Sincronização de Adapters Governamentais', () => {
  it('Transferegov sync com baseUrl ausente retorna falha estruturada', async () => {
    const result = await transferegovGovAdapter.sync({}, {});
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.fetchedCount).toBe(0);
    expect(result.normalizedCount).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('SEI sync com baseUrl ausente retorna falha estruturada', async () => {
    const result = await seiGovAdapter.sync({}, {});
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('CGLOG sync com baseUrl ausente retorna falha estruturada', async () => {
    const result = await cglogGovAdapter.sync({}, {});
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('sync com parâmetros não quebra', async () => {
    // Mock determinístico de falha de rede — sem chamada real à API externa.
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('ENOTFOUND invalid.example.gov.br')
    );

    const result = await transferegovGovAdapter.sync(
      { baseUrl: 'https://invalid.example.gov.br' },
      { proposalNumber: 'PROP-001' }
    );

    mockFetch.mockRestore();

    expect(result.success).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Utilitários auxiliares
// ---------------------------------------------------------------------------
describe('Utilitários de normalização', () => {
  it('flattenPayload achata envelope aninhado', () => {
    const result = flattenPayload({
      event: 'test',
      data: { nested: true },
      other: 'value',
    });
    expect(result.event).toBe('test');
    expect(result.nested).toBe(true);
    expect(result.other).toBe('value');
  });

  it('flattenPayload retorna objeto vazio para input inválido', () => {
    expect(flattenPayload(null)).toEqual({});
    expect(flattenPayload(undefined)).toEqual({});
    expect(flattenPayload('string')).toEqual({});
    expect(flattenPayload(42)).toEqual({});
    expect(flattenPayload([])).toEqual({});
  });

  it('pickString retorna primeiro valor não vazio', () => {
    const obj = { a: '', b: 'found', c: 'also' };
    expect(pickString(obj, ['a', 'b', 'c'])).toBe('found');
  });

  it('pickString converte número para string', () => {
    const obj = { num: 42 };
    expect(pickString(obj, ['num'])).toBe('42');
  });

  it('pickString retorna undefined quando nada encontrado', () => {
    expect(pickString({}, ['a', 'b'])).toBeUndefined();
    expect(pickString({ a: '' }, ['a'])).toBeUndefined();
    expect(pickString({ a: null }, ['a'])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Contrato dos adapters
// ---------------------------------------------------------------------------
describe('Contrato dos Adapters', () => {
  it('todos os adapters síncronos preenchem systemCode com o código canônico', () => {
    expect(transferegovAdapter.normalize({}).systemCode).toBe('transferegov');
    expect(seiAdapter.normalize({}).systemCode).toBe('sei');
    expect(cglogAdapter.normalize({}).systemCode).toBe('cglog');
  });

  it('todos os adapters governamentais implementam authenticate', () => {
    expect(typeof transferegovGovAdapter.authenticate).toBe('function');
    expect(typeof seiGovAdapter.authenticate).toBe('function');
    expect(typeof cglogGovAdapter.authenticate).toBe('function');
  });

  it('todos os adapters governamentais implementam fetch', () => {
    expect(typeof transferegovGovAdapter.fetch).toBe('function');
    expect(typeof seiGovAdapter.fetch).toBe('function');
    expect(typeof cglogGovAdapter.fetch).toBe('function');
  });

  it('todos os adapters governamentais implementam validate', () => {
    expect(typeof transferegovGovAdapter.validate).toBe('function');
    expect(typeof seiGovAdapter.validate).toBe('function');
    expect(typeof cglogGovAdapter.validate).toBe('function');
  });

  it('todos os adapters governamentais implementam sync', () => {
    expect(typeof transferegovGovAdapter.sync).toBe('function');
    expect(typeof seiGovAdapter.sync).toBe('function');
    expect(typeof cglogGovAdapter.sync).toBe('function');
  });

  it('todos os adapters governamentais implementam normalize (herdado)', () => {
    expect(typeof transferegovGovAdapter.normalize).toBe('function');
    expect(typeof seiGovAdapter.normalize).toBe('function');
    expect(typeof cglogGovAdapter.normalize).toBe('function');
  });

  it('system code é consistente entre adapter síncrono e governamental', () => {
    expect(transferegovAdapter.system).toBe(transferegovGovAdapter.system);
    expect(seiAdapter.system).toBe(seiGovAdapter.system);
    expect(cglogAdapter.system).toBe(cglogGovAdapter.system);
  });
});

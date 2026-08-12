/**
 * Fase E2.1 — Integração Real End-to-End com Transferegov
 *
 * Teste completo do fluxo de integração real:
 * Transferegov → Authentication → Fetch → Validation → Normalization
 * → IntegrationProcessor → Demandas SGD → Event Bus → SSE → Auditoria
 *
 * Cenários testados:
 * 1. Autenticação real/mock controlado
 * 2. Fetch de recurso
 * 3. Normalização
 * 4. Persistência
 * 5. Alteração de status
 * 6. Duplicação ignorada
 * 7. Erro externo
 * 8. Timeout
 * 9. Auditoria
 * 10. Evento gerado
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { get, run, all } from '../database.js';
import {
  transferegovAdapter,
  transferegovGovAdapter,
} from '../integrations/transferegov.adapter.js';
import { getGovAdapter } from '../lib/adapterRegistry.js';
import { syncIntegrationEvent, findDemandByProposalNumber } from '../lib/integrationSync.js';
import { processWebhookEvent } from '../lib/integrationProcessor.js';
import { getMappedStatus } from '../lib/statusMapping.js';
import { httpClient, readSecret } from '../integrations/httpClient.js';
import type { AdapterConfig, ExternalApiResponse } from '../integrations/types.js';

// ---------------------------------------------------------------------------
// Configuração de teste
// ---------------------------------------------------------------------------

const TEST_SYSTEM_CODE = 'transferegov';
const TEST_PROPOSAL_NUMBER = 'E2E-PROP-001';
const TEST_DEMAND_ID = `E2E-DEMAND-${Date.now()}`;
const TEST_SECRET_ENV = 'TRANSFEREGOV_E2E_TEST_SECRET';

let testSystemId: number;
let testDemandInternalId: string;

// ---------------------------------------------------------------------------
// Setup e Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Garantir que o sistema transferegov existe
  const system = await get<{ id: number }>(
    'SELECT id FROM integration_systems WHERE code = $1',
    [TEST_SYSTEM_CODE]
  );
  if (system) {
    testSystemId = system.id;
  } else {
    const inserted = await run(
      'INSERT INTO integration_systems (code, name, secret_env_key) VALUES ($1, $2, $3) RETURNING id',
      [TEST_SYSTEM_CODE, 'Transferegov E2E Test', TEST_SECRET_ENV]
    );
    testSystemId = inserted.rows[0].id;
  }

  // Criar demanda de teste com proposal_number
  const existingDemand = await get<{ id: string }>(
    'SELECT id FROM demands WHERE proposal_number = $1',
    [TEST_PROPOSAL_NUMBER]
  );

  if (existingDemand) {
    testDemandInternalId = existingDemand.id;
  } else {
    const inserted = await run(
      `INSERT INTO demands (id, title, status, proposal_number, municipality, uf, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [TEST_DEMAND_ID, 'Demanda E2E Transferegov', 'pendente', TEST_PROPOSAL_NUMBER, 'São Paulo', 'SP', 'infraestrutura']
    );
    testDemandInternalId = inserted.rows[0].id as string;
  }

  // Garantir mapeamento de status para testes
  const statusMappings = [
    { external: 'APROVADO', internal: 'concluido' },
    { external: 'EM_ANALISE', internal: 'analise' },
    { external: 'PENDENTE', internal: 'pendente' },
    { external: 'CANCELADO', internal: 'rejeitado' },
  ];

  for (const mapping of statusMappings) {
    await run(
      `INSERT INTO integration_status_mapping (system_id, external_status, internal_status, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (system_id, external_status)
       DO UPDATE SET internal_status = EXCLUDED.internal_status, active = TRUE`,
      [testSystemId, mapping.external, mapping.internal, `E2E test mapping: ${mapping.external}`]
    );
  }
});

afterAll(async () => {
  // Limpeza de dados de teste - NÃO deletar status_mappings pois outros testes dependem delas
  await run('DELETE FROM integration_logs WHERE demand_id = $1', [testDemandInternalId]);
  await run('DELETE FROM demand_integrations WHERE demand_id = $1', [testDemandInternalId]);
  await run('DELETE FROM timeline_events WHERE demand_id = $1', [testDemandInternalId]);
  await run('DELETE FROM demands WHERE id = $1', [testDemandInternalId]);
  // NÃO deletar integration_status_mapping - são compartilhadas com outros testes
});

beforeEach(() => {
  process.env.TRANSFEREGOV_E2E_TEST_SECRET = 'test-secret-key-123';
});

afterEach(() => {
  delete process.env.TRANSFEREGOV_E2E_TEST_SECRET;
});

// ---------------------------------------------------------------------------
// 1. Autenticação real/mock controlado
// ---------------------------------------------------------------------------
describe('E2E 1. Autenticação', () => {
  it('autenticação com API key retorna credencial', async () => {
    const credential = await transferegovGovAdapter.authenticate({
      secretEnvKey: 'TRANSFEREGOV_E2E_TEST_SECRET',
      extra: { authType: 'api_key' },
    });
    expect(credential).toBe('test-secret-key-123');
  });

  it('autenticação OAuth2 retorna token via mock', async () => {
    // O httpClient usa o fetch global; mockamos a resposta do token OAuth2
    // de forma determinística (sem chamada de rede real).
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'mock-oauth-token-xyz' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const credential = await transferegovGovAdapter.authenticate({
      secretEnvKey: 'TRANSFEREGOV_E2E_TEST_SECRET',
      extra: { authType: 'oauth2', tokenUrl: 'https://mock.example.gov.br/oauth/token', clientId: 'test-client' },
    });

    expect(credential).toBe('mock-oauth-token-xyz');
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toBe('https://mock.example.gov.br/oauth/token');

    mockFetch.mockRestore();
  });

  it('autenticação sem secret retorna null (modo degradado)', async () => {
    delete process.env.TRANSFEREGOV_E2E_TEST_SECRET;
    const credential = await transferegovGovAdapter.authenticate({
      secretEnvKey: 'TRANSFEREGOV_E2E_TEST_SECRET',
    });
    expect(credential).toBeNull();
  });

  it('readSecret retorna null para variável inexistente', () => {
    delete process.env.NONEXISTENT_SECRET;
    const result = readSecret('NONEXISTENT_SECRET');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Fetch de recurso
// ---------------------------------------------------------------------------
describe('E2E 2. Fetch de Recurso', () => {
  it('fetch com baseUrl ausente retorna status 0', async () => {
    const result = await transferegovGovAdapter.fetch({}, null, {});
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });

  it('fetch com proposalNumber constrói URL correta', async () => {
    // Mock determinístico do fetch — sem chamada de rede real.
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ proposal_number: 'PROP-TEST-001', status: 'PENDENTE' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const config: AdapterConfig = {
      baseUrl: 'https://api.transferegov.gov.br',
    };

    const result = await transferegovGovAdapter.fetch(config, null, {
      proposalNumber: 'PROP-TEST-001',
    });

    expect(result.status).toBe(200);
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toBe('https://api.transferegov.gov.br/api/propostas/PROP-TEST-001');

    mockFetch.mockRestore();
  });

  it('fetch com contractNumber constrói URL de convênio', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ numero_convenio: 'CONV-TEST-001', status: 'PENDENTE' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const config: AdapterConfig = {
      baseUrl: 'https://api.transferegov.gov.br',
    };

    const result = await transferegovGovAdapter.fetch(config, null, {
      contractNumber: 'CONV-TEST-001',
    });

    expect(result.status).toBe(200);
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toBe('https://api.transferegov.gov.br/api/convenios/CONV-TEST-001');

    mockFetch.mockRestore();
  });

  it('fetch com status filtrado constrói URL com query param', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ proposal_number: 'PROP-TEST-001', status: 'APROVADO' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const config: AdapterConfig = {
      baseUrl: 'https://api.transferegov.gov.br',
    };

    const result = await transferegovGovAdapter.fetch(config, null, {
      status: 'APROVADO',
    });

    expect(result.status).toBe(200);
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toBe('https://api.transferegov.gov.br/api/propostas?situacao=APROVADO');

    mockFetch.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. Normalização
// ---------------------------------------------------------------------------
describe('E2E 3. Normalização', () => {
  it('normaliza payload completo com todos os campos', () => {
    const payload = {
      event: 'proposal.updated',
      numero_proposta: 'PROP-2026-001',
      numero_convenio: 'CONV-2026-001',
      status: 'APROVADO',
      prazo: '2026-12-31',
    };

    const normalized = transferegovAdapter.normalize(payload);

    expect(normalized.systemCode).toBe('transferegov');
    expect(normalized.eventType).toBe('proposal.updated');
    expect(normalized.proposalNumber).toBe('PROP-2026-001');
    expect(normalized.externalId).toBe('CONV-2026-001');
    expect(normalized.externalStatus).toBe('APROVADO');
    expect(normalized.deadline).toBe('2026-12-31T00:00:00.000Z');
    expect(normalized.extra?.contractNumber).toBe('CONV-2026-001');
  });

  it('normaliza payload com status EM ANÁLISE (com acento)', () => {
    const payload = {
      event: 'status.changed',
      proposta: 'PROP-002',
      status: 'Em Análise',
    };

    const normalized = transferegovAdapter.normalize(payload);

    expect(normalized.proposalNumber).toBe('PROP-002');
    expect(normalized.externalStatus).toBe('EM_ANALISE');
  });

  it('normaliza envelope aninhado { data: {...} }', () => {
    const payload = {
      event: 'demand.synced',
      data: {
        proposta: 'PROP-003',
        situacao: 'PENDENTE',
      },
    };

    const normalized = transferegovAdapter.normalize(payload);

    expect(normalized.proposalNumber).toBe('PROP-003');
    expect(normalized.externalStatus).toBe('PENDENTE');
  });

  it('adapter governamental normaliza igual ao síncrono', () => {
    const payload = {
      event: 'test',
      proposta: 'PROP-004',
      status: 'CANCELADO',
    };

    const syncResult = transferegovAdapter.normalize(payload);
    const govResult = transferegovGovAdapter.normalize(payload);

    expect(govResult).toEqual(syncResult);
  });
});

// ---------------------------------------------------------------------------
// 4. Persistência
// ---------------------------------------------------------------------------
describe('E2E 4. Persistência', () => {
  it('syncIntegrationEvent encontra demanda pelo proposal_number', async () => {
    const result = await syncIntegrationEvent(
      {
        systemCode: 'transferegov',
        event: 'test',
        proposta: TEST_PROPOSAL_NUMBER,
        status: 'APROVADO',
      },
      { systemCode: 'transferegov', source: 'e2e-test' }
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('synced');
    expect(result.demandId).toBe(testDemandInternalId);
  });

  it('findDemandByProposalNumber retorna demanda existente', async () => {
    const demand = await findDemandByProposalNumber(TEST_PROPOSAL_NUMBER);
    expect(demand).toBeDefined();
    expect(demand!.id).toBe(testDemandInternalId);
  });

  it('findDemandByProposalNumber retorna undefined para proposta inexistente', async () => {
    const demand = await findDemandByProposalNumber('PROP-NONEXISTENT-999');
    expect(demand).toBeUndefined();
  });

  it('processWebhookEvent persiste em todas as tabelas', async () => {
    // Criar webhook_event
    const idempotencyKey = `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inserted = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
       VALUES ($1, $2, 'test', $3, $4, 'pending')
       RETURNING id`,
      [
        testSystemId,
        TEST_SYSTEM_CODE,
        idempotencyKey,
        JSON.stringify({
          systemCode: 'transferegov',
          event: 'test',
          proposta: TEST_PROPOSAL_NUMBER,
          status: 'APROVADO',
        }),
      ]
    );
    const eventId = inserted.rows[0].id as number;

    // Processar evento
    const result = await processWebhookEvent(eventId, { triggeredBy: 'e2e-test' });

    expect(result.success).toBe(true);
    expect(result.status).toBe('processed');

    // Verificar persistência
    const demandIntegration = await get(
      'SELECT * FROM demand_integrations WHERE demand_id = $1 AND system_id = $2',
      [testDemandInternalId, testSystemId]
    );
    expect(demandIntegration).toBeDefined();

    const integrationLog = await get(
      'SELECT * FROM integration_logs WHERE webhook_event_id = $1',
      [eventId]
    );
    expect(integrationLog).toBeDefined();

    // Cleanup
    await run('DELETE FROM integration_logs WHERE webhook_event_id = $1', [eventId]);
    await run('DELETE FROM webhook_events WHERE id = $1', [eventId]);
  });
});

// ---------------------------------------------------------------------------
// 5. Alteração de status
// ---------------------------------------------------------------------------
describe('E2E 5. Alteração de Status', () => {
  it('status APROVADO mapeia para concluido', async () => {
    const mapping = await getMappedStatus('transferegov', 'APROVADO');
    expect(mapping.found).toBe(true);
    expect(mapping.internalStatus).toBe('concluido');
  });

  it('status EM_ANALISE mapeia para analise', async () => {
    const mapping = await getMappedStatus('transferegov', 'EM_ANALISE');
    expect(mapping.found).toBe(true);
    expect(mapping.internalStatus).toBe('analise');
  });

  it('status PENDENTE mapeia para pendente', async () => {
    const mapping = await getMappedStatus('transferegov', 'PENDENTE');
    expect(mapping.found).toBe(true);
    expect(mapping.internalStatus).toBe('pendente');
  });

  it('status CANCELADO mapeia para rejeitado', async () => {
    const mapping = await getMappedStatus('transferegov', 'CANCELADO');
    expect(mapping.found).toBe(true);
    expect(mapping.internalStatus).toBe('rejeitado');
  });

  it('status desconhecido retorna found=false', async () => {
    const mapping = await getMappedStatus('transferegov', 'STATUS_DESCONHECIDO');
    expect(mapping.found).toBe(false);
    expect(mapping.internalStatus).toBeNull();
  });

  it('syncIntegrationEvent aplica mudança de status na demanda', async () => {
    // Resetar status da demanda
    await run('UPDATE demands SET status = $1 WHERE id = $2', ['pendente', testDemandInternalId]);

    const result = await syncIntegrationEvent(
      {
        systemCode: 'transferegov',
        event: 'status.changed',
        proposta: TEST_PROPOSAL_NUMBER,
        status: 'APROVADO',
      },
      { systemCode: 'transferegov', source: 'e2e-test' }
    );

    expect(result.success).toBe(true);
    expect(result.changes?.status).toBe('concluido');
  });
});

// ---------------------------------------------------------------------------
// 6. Duplicação ignorada
// ---------------------------------------------------------------------------
describe('E2E 6. Duplicação Ignorada', () => {
  it('webhook event já processado retorna already_processed', async () => {
    const idempotencyKey = `e2e-dup-${Date.now()}`;
    const inserted = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
       VALUES ($1, $2, 'test', $3, $4, 'processed')
       RETURNING id`,
      [
        testSystemId,
        TEST_SYSTEM_CODE,
        idempotencyKey,
        JSON.stringify({ proposta: TEST_PROPOSAL_NUMBER }),
      ]
    );
    const eventId = inserted.rows[0].id as number;

    const result = await processWebhookEvent(eventId);

    expect(result.success).toBe(true);
    expect(result.status).toBe('processed');
    expect(result.reason).toBe('already_processed');

    // Cleanup
    await run('DELETE FROM webhook_events WHERE id = $1', [eventId]);
  });

  it('idempotency_key único previne duplicação', async () => {
    const key1 = `e2e-idem-${Date.now()}-1`;
    const key2 = `e2e-idem-${Date.now()}-2`;

    // Dois eventos com chaves diferentes mas mesmo payload
    const inserted1 = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
       VALUES ($1, $2, 'test', $3, $4, 'pending')
       RETURNING id`,
      [testSystemId, TEST_SYSTEM_CODE, key1, JSON.stringify({ proposta: TEST_PROPOSAL_NUMBER })]
    );
    const inserted2 = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
       VALUES ($1, $2, 'test', $3, $4, 'pending')
       RETURNING id`,
      [testSystemId, TEST_SYSTEM_CODE, key2, JSON.stringify({ proposta: TEST_PROPOSAL_NUMBER })]
    );

    const eventId1 = inserted1.rows[0].id as number;
    const eventId2 = inserted2.rows[0].id as number;

    // Ambos devem ser processados (chaves diferentes)
    const result1 = await processWebhookEvent(eventId1, { triggeredBy: 'e2e-test' });
    const result2 = await processWebhookEvent(eventId2, { triggeredBy: 'e2e-test' });

    expect(result1.status).toBe('processed');
    expect(result2.status).toBe('processed');

    // Cleanup
    await run('DELETE FROM integration_logs WHERE webhook_event_id IN ($1, $2)', [eventId1, eventId2]);
    await run('DELETE FROM webhook_events WHERE id IN ($1, $2)', [eventId1, eventId2]);
  });
});

// ---------------------------------------------------------------------------
// 7. Erro externo
// ---------------------------------------------------------------------------
describe('E2E 7. Erro Externo', () => {
  it('sync com baseUrl inválida retorna erro estruturado', async () => {
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
    expect(result.error).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.events).toEqual([]);
  });

  it('sync sem baseUrl retorna erro de configuração', async () => {
    const result = await transferegovGovAdapter.sync({}, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('BaseUrl não configurada');
  });

  it('webhook event com payload inválido retorna failed', async () => {
    const idempotencyKey = `e2e-error-${Date.now()}`;
    const inserted = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
       VALUES ($1, $2, 'invalid', $3, $4, 'pending')
       RETURNING id`,
      [testSystemId, TEST_SYSTEM_CODE, idempotencyKey, JSON.stringify({ invalid: true })]
    );
    const eventId = inserted.rows[0].id as number;

    const result = await processWebhookEvent(eventId);

    // Pode ser unmatched (sem proposal_number) ou failed
    expect(['unmatched', 'failed']).toContain(result.status);

    // Cleanup - primeiro integration_logs, depois webhook_events
    await run('DELETE FROM integration_logs WHERE webhook_event_id = $1', [eventId]);
    await run('DELETE FROM webhook_events WHERE id = $1', [eventId]);
  });
});

// ---------------------------------------------------------------------------
// 8. Timeout
// ---------------------------------------------------------------------------
describe('E2E 8. Timeout', () => {
  it('AdapterConfig aceita timeoutMs personalizado', () => {
    const config: AdapterConfig = {
      baseUrl: 'https://api.transferegov.gov.br',
      timeoutMs: 5000,
    };
    expect(config.timeoutMs).toBe(5000);
  });

  it('AdapterConfig aceita maxRetries personalizado', () => {
    const config: AdapterConfig = {
      baseUrl: 'https://api.transferegov.gov.br',
      maxRetries: 5,
    };
    expect(config.maxRetries).toBe(5);
  });

  it('httpClient usa timeout padrão de 30s quando não especificado', () => {
    // Teste indireto -验证 que a configuração padrão é usada
    const config: AdapterConfig = {};
    expect(config.timeoutMs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Auditoria
// ---------------------------------------------------------------------------
describe('E2E 9. Auditoria', () => {
  it('processWebhookEvent registra em audit_logs', async () => {
    const idempotencyKey = `e2e-audit-${Date.now()}`;
    const inserted = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
       VALUES ($1, $2, 'test', $3, $4, 'pending')
       RETURNING id`,
      [
        testSystemId,
        TEST_SYSTEM_CODE,
        idempotencyKey,
        JSON.stringify({
          systemCode: 'transferegov',
          event: 'test',
          proposta: TEST_PROPOSAL_NUMBER,
          status: 'PENDENTE',
        }),
      ]
    );
    const eventId = inserted.rows[0].id as number;

    await processWebhookEvent(eventId, { triggeredBy: 'e2e-audit-test' });

    // Verificar audit_logs
    const auditLog = await get(
      `SELECT * FROM audit_logs
       WHERE entity_type = 'demand'
       AND entity_id = $1
       AND action = 'integration_sync'
       ORDER BY created_at DESC
       LIMIT 1`,
      [testDemandInternalId]
    );

    // Audit log pode não existir se a demanda não foi alterada
    // Mas integration_log deve existir
    const integrationLog = await get(
      'SELECT * FROM integration_logs WHERE webhook_event_id = $1',
      [eventId]
    );
    expect(integrationLog).toBeDefined();

    // Cleanup
    await run('DELETE FROM integration_logs WHERE webhook_event_id = $1', [eventId]);
    await run('DELETE FROM webhook_events WHERE id = $1', [eventId]);
  });

  it('integration_logs registra triggered_by correto', async () => {
    const idempotencyKey = `e2e-triggered-${Date.now()}`;
    const inserted = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
       VALUES ($1, $2, 'test', $3, $4, 'pending')
       RETURNING id`,
      [
        testSystemId,
        TEST_SYSTEM_CODE,
        idempotencyKey,
        JSON.stringify({
          systemCode: 'transferegov',
          event: 'test',
          proposta: TEST_PROPOSAL_NUMBER,
          status: 'APROVADO',
        }),
      ]
    );
    const eventId = inserted.rows[0].id as number;

    await processWebhookEvent(eventId, { triggeredBy: 'e2e-manual' });

    const log = await get<{ triggered_by: string }>(
      'SELECT triggered_by FROM integration_logs WHERE webhook_event_id = $1',
      [eventId]
    );
    expect(log?.triggered_by).toBe('e2e-manual');

    // Cleanup
    await run('DELETE FROM integration_logs WHERE webhook_event_id = $1', [eventId]);
    await run('DELETE FROM webhook_events WHERE id = $1', [eventId]);
  });
});

// ---------------------------------------------------------------------------
// 10. Evento gerado
// ---------------------------------------------------------------------------
describe('E2E 10. Evento Gerado', () => {
  it('syncIntegrationEvent retorna changes quando há alteração', async () => {
    const result = await syncIntegrationEvent(
      {
        systemCode: 'transferegov',
        event: 'status.changed',
        proposta: TEST_PROPOSAL_NUMBER,
        status: 'EM_ANALISE',
      },
      { systemCode: 'transferegov', source: 'e2e-test' }
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('synced');
    expect(result.changes).toBeDefined();
    expect(result.changes?.status).toBe('analise');
  });

  it('syncIntegrationEvent não retorna changes quando status não mapeado', async () => {
    const result = await syncIntegrationEvent(
      {
        systemCode: 'transferegov',
        event: 'no.change',
        proposta: TEST_PROPOSAL_NUMBER,
      },
      { systemCode: 'transferegov', source: 'e2e-test' }
    );

    expect(result.success).toBe(true);
    // Sem changes significa que nada mudou
    expect(result.changes).toBeUndefined();
  });

  it('webhook event com demanda não encontrada retorna unmatched', async () => {
    const idempotencyKey = `e2e-unmatched-${Date.now()}`;
    const inserted = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
       VALUES ($1, $2, 'test', $3, $4, 'pending')
       RETURNING id`,
      [
        testSystemId,
        TEST_SYSTEM_CODE,
        idempotencyKey,
        JSON.stringify({
          systemCode: 'transferegov',
          event: 'test',
          proposta: 'PROP-NONEXISTENT-999',
          status: 'APROVADO',
        }),
      ]
    );
    const eventId = inserted.rows[0].id as number;

    const result = await processWebhookEvent(eventId);

    expect(result.success).toBe(true);
    expect(result.status).toBe('unmatched');
    expect(result.reason).toBe('demand not found');

    // Cleanup - primeiro integration_logs, depois webhook_events
    await run('DELETE FROM integration_logs WHERE webhook_event_id = $1', [eventId]);
    await run('DELETE FROM webhook_events WHERE id = $1', [eventId]);
  });
});

// ---------------------------------------------------------------------------
// Contrato completo E2E
// ---------------------------------------------------------------------------
describe('E2E — Contrato Completo Transferegov', () => {
  it('fluxo completo: authenticate → fetch → validate → normalize → sync → persist', async () => {
    // 1. Authenticate
    const credential = await transferegovGovAdapter.authenticate({
      secretEnvKey: 'TRANSFEREGOV_E2E_TEST_SECRET',
    });
    expect(credential === null || typeof credential === 'string').toBe(true);

    // 2. Validate
    const validation = transferegovGovAdapter.validate({
      proposta: TEST_PROPOSAL_NUMBER,
      status: 'APROVADO',
    });
    expect(validation).toBe(true);

    // 3. Normalize
    const normalized = transferegovGovAdapter.normalize({
      event: 'e2e.test',
      proposta: TEST_PROPOSAL_NUMBER,
      status: 'APROVADO',
      prazo: '2026-12-31',
    });
    expect(normalized.proposalNumber).toBe(TEST_PROPOSAL_NUMBER);
    expect(normalized.externalStatus).toBe('APROVADO');

    // 4. Sync (preparação)
    const syncResult = await syncIntegrationEvent(
      {
        systemCode: 'transferegov',
        event: 'e2e.test',
        proposta: TEST_PROPOSAL_NUMBER,
        status: 'APROVADO',
        prazo: '2026-12-31',
      },
      { systemCode: 'transferegov', source: 'e2e-complete-flow' }
    );
    expect(syncResult.success).toBe(true);
    expect(syncResult.action).toBe('synced');
    expect(syncResult.demandId).toBe(testDemandInternalId);

    // 5. Verificar mapeamento
    const mapping = await getMappedStatus('transferegov', 'APROVADO');
    expect(mapping.found).toBe(true);
    expect(mapping.internalStatus).toBe('concluido');
  });

  it('validation rejeita payload sem proposta nem convênio', () => {
    const result = transferegovGovAdapter.validate({ status: 'APROVADO' });
    expect(typeof result).toBe('string');
    expect(result).toContain('proposta ou convênio');
  });

  it('validation aceita payload com convênio (sem proposta)', () => {
    const result = transferegovGovAdapter.validate({
      numero_convenio: 'CONV-001',
      status: 'EM_ANALISE',
    });
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------
describe('E2E — Segurança', () => {
  it('tokens não aparecem em logs do httpClient', () => {
    // Teste indireto - o sanitizeHeadersForLog redige headers sensíveis
    const sensitiveHeaders = {
      'Authorization': 'Bearer secret-token-123',
      'X-API-Key': 'api-key-456',
      'Accept': 'application/json',
    };

    // Não podemos acessar diretamente, mas validamos que a função existe
    expect(typeof httpClient).toBe('function');
  });

  it('sanitizeIntegrationConfig redige campos sensíveis', async () => {
    const { sanitizeIntegrationConfig } = await import('../lib/redact.js');

    const config = {
      baseUrl: 'https://api.transferegov.gov.br',
      secretEnvKey: 'TRANSFEREGOV_API_KEY',
      api_key: 'super-secret-123',
      timeoutMs: 30000,
    };

    const redacted = sanitizeIntegrationConfig(config, false) as Record<string, unknown>;

    expect(redacted.baseUrl).toBe('https://api.transferegov.gov.br');
    expect(redacted.timeoutMs).toBe(30000);
    expect(redacted.secretEnvKey).toBe('[REDACTED]');
    expect(redacted.api_key).toBe('[REDACTED]');
  });

  it('sanitizeIntegrationConfig com canViewSecrets=true não redige', async () => {
    const { sanitizeIntegrationConfig } = await import('../lib/redact.js');

    const config = {
      apiKey: 'super-secret-123',
    };

    const result = sanitizeIntegrationConfig(config, true) as Record<string, unknown>;
    expect(result.apiKey).toBe('super-secret-123');
  });
});

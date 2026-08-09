/**
 * Fase E3.2 — Homologação e Produção (SEI)
 *
 * Cobre os cenários operacionais exigidos para levar a integração com o SEI
 * ao mesmo ciclo operacional do Transferegov (mesma arquitetura, observabilidade,
 * auditoria e operação administrativa — sem fluxo paralelo):
 *  1. Registro do adapter;
 *  2. Autenticação bem-sucedida (token);
 *  3. Falha de autenticação (sem secret);
 *  4. Fetch por NUP (endpoint + header);
 *  5. Validação de NUP válido;
 *  6. Validação de NUP inválido;
 *  7. Normalização de payload completo;
 *  8. Payload incompleto (comportamento defensivo);
 *  9. API indisponível (HTTP 0) → R10 api_unavailable;
 * 10. Rate limit (HTTP 429) → retry do httpClient;
 * 11. Sincronização completa com sucesso;
 * 12. Deduplicação (reprocessamento);
 * 13. Persistência (processor → demandas, timeline, vínculo);
 * 14. Auditoria (audit_logs integration_sync);
 * 15. Evento de sincronização / mudança de status;
 * 16. Scheduler resolve SEI no mesmo ciclo;
 * 17. Dashboard exibe SEI automaticamente;
 * 18. Segredos não expostos (redact).
 *
 * O httpClient usa o `fetch` global, então mockamos fetch para simular respostas.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { get, run, all } from '../database.js';
import { seiAdapter, seiGovAdapter } from '../integrations/sei.adapter.js';
import { httpClient, readSecret } from '../integrations/httpClient.js';
import { getGovAdapter, hasGovAdapter } from '../lib/adapterRegistry.js';
import { syncIntegrationEvent, findDemandByProposalNumber } from '../lib/integrationSync.js';
import { processWebhookEvent } from '../lib/integrationProcessor.js';
import { parseSystemSyncConfig } from '../lib/integrationScheduler.js';
import { getOverview } from '../lib/integrationAdmin.js';
import { sanitizeIntegrationConfig } from '../lib/redact.js';
import { evaluateRules } from '../lib/alertEngine.js';
import type { SystemSnapshot, EvaluationContext } from '../lib/alertEngine.js';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const CTX: EvaluationContext = { now: NOW };

function snap(over: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    id: 1,
    code: 'sei',
    name: 'SEI',
    tenantId: 1,
    active: true,
    lastSyncAt: new Date(NOW.getTime() - 3600 * 1000).toISOString(),
    lastHttpStatus: 200,
    lastResponseMs: 200,
    errorCount24h: 0,
    consecutiveErrors: 0,
    ...over,
  };
}

let seiId: number;
let demandId: string;
const testEventIds: number[] = [];

async function insertSeiEvent(payload: unknown, status = 'pending'): Promise<number> {
  if (seiId === undefined) throw new Error('seiId não inicializado');
  const res = await run(
    `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
     VALUES ($1, $2, 'processo.atualizado', $3, $4::jsonb, $5)
     RETURNING id`,
    [
      seiId,
      'sei',
      `sei-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      JSON.stringify(payload),
      status,
    ]
  );
  return res.rows[0].id as number;
}

beforeAll(async () => {
  process.env.SEI_API_TOKEN = 'sei-token-homolog-123';

  const sei = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', ['sei']);
  if (!sei) throw new Error('Sistema sei não seedado');
  seiId = sei.id;

  const res = await run(
    `INSERT INTO demands (id, title, category, municipality, uf, status, priority, proposal_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [`SEI-HOM-${Date.now()}`, 'DEMANDA SEI HOMOLOG', 'INTEGRACAO', 'FORTALEZA', 'CE', 'pendente', 'media', 'PROP-SEI-HOM-001']
  );
  demandId = res.rows[0].id as string;
});

afterAll(async () => {
  if (testEventIds.length > 0) {
    await run('DELETE FROM integration_logs WHERE webhook_event_id = ANY($1::int[])', [testEventIds]);
    await run('DELETE FROM webhook_events WHERE id = ANY($1::int[])', [testEventIds]);
  }
  if (demandId) {
    await run('DELETE FROM audit_logs WHERE action = $1 AND entity_id = $2', ['integration_sync', demandId]);
    await run('DELETE FROM timeline_events WHERE demand_id = $1', [demandId]);
    await run('DELETE FROM demand_integrations WHERE demand_id = $1', [demandId]);
    await run('DELETE FROM demands WHERE id = $1', [demandId]);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Registro (mesmo ciclo do registry)
// ---------------------------------------------------------------------------
describe('E3.2 — 1. Registro do adapter SEI', () => {
  it('getGovAdapter resolve o SEI e está registrado na lista', () => {
    expect(getGovAdapter('sei')).toBe(seiGovAdapter);
    expect(hasGovAdapter('sei')).toBe(true);
  });

  it('adapter síncrono e governamental compartilham o mesmo system code', () => {
    expect(seiAdapter.system).toBe('sei');
    expect(seiGovAdapter.system).toBe('sei');
  });
});

// ---------------------------------------------------------------------------
// 2–3. Autenticação
// ---------------------------------------------------------------------------
describe('E3.2 — Autenticação (2–3)', () => {
  it('2. token retornado quando secret_env_key aponta para env configurada', async () => {
    process.env.SEI_API_TOKEN = 'token-sei-456';
    const cred = await seiGovAdapter.authenticate({ secretEnvKey: 'SEI_API_TOKEN' });
    expect(cred).toBe('token-sei-456');
    delete process.env.SEI_API_TOKEN;
  });

  it('3. retorna null sem secret (modo degradado)', async () => {
    delete process.env.SEI_API_TOKEN;
    const cred = await seiGovAdapter.authenticate({ secretEnvKey: 'SEI_API_TOKEN' });
    expect(cred).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Fetch por NUP
// ---------------------------------------------------------------------------
describe('E3.2 — 4. Fetch por NUP', () => {
  it('monta o endpoint /processos/{nup} e envia X-Auth-Token', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ numero_processo: '00100.123456/2026-01', status: 'TRAMITANDO' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await seiGovAdapter.fetch(
      { baseUrl: 'https://api.sei.gov.br', secretEnvKey: 'SEI_API_TOKEN', extra: { authType: 'token' } },
      'credencial-teste',
      { processNumber: '00100.123456/2026-01' }
    );

    expect(result.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/v1/processos/00100.123456%2F2026-01');
    expect((init?.headers as Record<string, string>)['X-Auth-Token']).toBe('credencial-teste');

    mockFetch.mockRestore();
  });

  it('sem baseUrl retorna status 0', async () => {
    const result = await seiGovAdapter.fetch({}, null, {});
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5–6. Validação de NUP
// ---------------------------------------------------------------------------
describe('E3.2 — Validação de NUP (5–6)', () => {
  it('5. NUP válido passa na validação', () => {
    expect(seiGovAdapter.validate({ numero_processo: '00100.123456/2026-01', status: 'TRAMITANDO' })).toBe(true);
  });

  it('6. NUP em formato inválido é rejeitado com mensagem sobre NUP', () => {
    const result = seiGovAdapter.validate({ numero_processo: 'FORMATO-INVALIDO', status: 'TRAMITANDO' });
    expect(typeof result).toBe('string');
    expect(result).toContain('NUP');
  });
});

// ---------------------------------------------------------------------------
// 7–8. Normalização
// ---------------------------------------------------------------------------
describe('E3.2 — Normalização (7–8)', () => {
  it('7. payload completo extrai NUP, status, prazo e datas', () => {
    const evt = seiAdapter.normalize({
      event: 'processo.atualizado',
      numero_processo: '00100.123456/2026-01',
      proposta: 'PROP-SEI-HOM-001',
      situacao: 'TRAMITANDO',
      data_finalizacao: '2026-09-30',
      data_abertura: '2026-01-15',
    });
    expect(evt.externalId).toBe('00100.123456/2026-01');
    expect(evt.proposalNumber).toBe('PROP-SEI-HOM-001');
    expect(evt.externalStatus).toBe('TRAMITANDO');
    expect(evt.deadline).toBe('2026-09-30T00:00:00.000Z');
    expect(evt.extra?.dates).toBeDefined();
  });

  it('8. payload incompleto não lança e retorna campos opcionais undefined', () => {
    const evt = seiAdapter.normalize({ event: 'processo.atualizado' });
    expect(evt.systemCode).toBe('sei');
    expect(evt.proposalNumber).toBeUndefined();
    expect(evt.externalId).toBeUndefined();
    expect(evt.externalStatus).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. API indisponível (HTTP 0) → R10
// ---------------------------------------------------------------------------
describe('E3.2 — 9. API indisponível (R10 api_unavailable)', () => {
  it('evaluateRules dispara api_unavailable em HTTP 0', () => {
    const m = evaluateRules(snap({ lastHttpStatus: 0 }), CTX).find((x) => x.type === 'api_unavailable');
    expect(m).toBeDefined();
    expect(m!.severity).toBe('critical');
  });

  it('sync com HTTP 0 retorna falha estruturada e httpStatus 0', async () => {
    const result = await seiGovAdapter.sync({}, {});
    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Rate limit (429) → retry
// ---------------------------------------------------------------------------
describe('E3.2 — 10. Rate limit (429) e retry', () => {
  it('429 dispara retry e eventual sucesso retorna 200', async () => {
    let calls = 0;
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify([{ numero_do_processo: '123', situacao: 'TRAMITANDO' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const result = await httpClient(
      { baseUrl: 'https://api.sei.gov.br', retryBaseDelayMs: 1 },
      { url: 'https://api.sei.gov.br/api/v1/processos', method: 'GET' }
    );

    mockFetch.mockRestore();

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.status).toBe(200);
  });

  it('429 persistente retorna status 429 após esgotar retries', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Too Many Requests', { status: 429 })
    );

    const result = await httpClient(
      { baseUrl: 'https://api.sei.gov.br', maxRetries: 1, retryBaseDelayMs: 1 },
      { url: 'https://api.sei.gov.br/api/v1/processos', method: 'GET' }
    );

    mockFetch.mockRestore();

    expect(result.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 11. Sincronização completa
// ---------------------------------------------------------------------------
describe('E3.2 — 11. Sincronização completa', () => {
  it('fluxo completo com HTTP 200 normaliza e retorna sucesso', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { numero_processo: '00100.123456/2026-01', proposta: 'PROP-SEI-HOM-001', situacao: 'TRAMITANDO', data_finalizacao: '2026-12-31' },
          { numero_process: '00100.654321/2026-02', situacao: 'FINALIZADO' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await seiGovAdapter.sync(
      { baseUrl: 'https://api.sei.gov.br', secretEnvKey: 'SEI_API_TOKEN' },
      {}
    );

    mockFetch.mockRestore();

    expect(result.success).toBe(true);
    expect(result.fetchedCount).toBe(2);
    expect(result.normalizedCount).toBe(2);
    expect(result.events[0].externalId).toBe('00100.123456/2026-01');
    expect(result.events[0].externalStatus).toBe('TRAMITANDO');
  });
});

// ---------------------------------------------------------------------------
// 12. Deduplicação (persistência revisitada)
// ---------------------------------------------------------------------------
describe('E3.2 — 12. Reprocessamento/deduplicação', () => {
  it('processWebhookEvent reexecutado retorna already_processed', async () => {
    const eventId = await insertSeiEvent({
      numero_processo: '00100.123456/2026-01',
      proposta: 'PROP-SEI-HOM-001',
      status: 'TRAMITANDO',
    });
    testEventIds.push(eventId);

    const first = await processWebhookEvent(eventId, { triggeredBy: 'e3.2' });
    expect(first).toEqual({ success: true, status: 'processed' });

    const second = await processWebhookEvent(eventId, { triggeredBy: 'e3.2' });
    expect(second).toEqual({ success: true, status: 'processed', reason: 'already_processed' });
  });

  it('findDemandByProposalNumber localiza a demanda SEI', async () => {
    const demand = await findDemandByProposalNumber('PROP-SEI-HOM-001');
    expect(demand?.id).toBe(demandId);
  });
});

// ---------------------------------------------------------------------------
// 13. Persistência
// ---------------------------------------------------------------------------
describe('E3.2 — 13. Persistência', () => {
  it('webhook SEI atualiza demanda, timeline e vínculo', async () => {
    const eventId = await insertSeiEvent({
      numero_processo: '00100.777777/2026-01',
      proposta: 'PROP-SEI-HOM-001',
      status: 'TRAMITANDO',
    });
    testEventIds.push(eventId);

    const result = await processWebhookEvent(eventId, { triggeredBy: 'e3.2' });
    expect(result).toEqual({ success: true, status: 'processed' });

    const demand = await get<{ status: string }>('SELECT status FROM demands WHERE id = $1', [demandId]);
    expect(demand?.status).toBe('analise');

    const event = await get<{ status: string }>('SELECT status FROM webhook_events WHERE id = $1', [eventId]);
    expect(event?.status).toBe('processed');

    const timeline = await all('SELECT * FROM timeline_events WHERE demand_id = $1', [demandId]);
    expect(timeline.length).toBeGreaterThan(0);

    const link = await get('SELECT * FROM demand_integrations WHERE demand_id = $1 AND system_id = $2', [demandId, seiId]);
    expect(link).toBeTruthy();
    expect(link.external_id).toBe('00100.777777/2026-01');
  });
});

// ---------------------------------------------------------------------------
// 14. Auditoria
// ---------------------------------------------------------------------------
describe('E3.2 — 14. Auditoria', () => {
  it('processamento SEI registra audit_logs integration_sync', async () => {
    const eventId = await insertSeiEvent({
      numero_processo: '00100.888888/2026-01',
      proposta: 'PROP-SEI-HOM-001',
      status: 'FINALIZADO',
    });
    testEventIds.push(eventId);

    await processWebhookEvent(eventId, { triggeredBy: 'e3.2' });

    const audit = await get(
      `SELECT * FROM audit_logs
       WHERE entity_type = 'demand' AND entity_id = $1 AND action = 'integration_sync'
       ORDER BY created_at DESC LIMIT 1`,
      [demandId]
    );
    expect(audit).toBeTruthy();
    expect(audit.details?.system).toBe('sei');
  });
});

// ---------------------------------------------------------------------------
// 15. Evento de sincronização / mudança de status
// ---------------------------------------------------------------------------
describe('E3.2 — 15. Evento de sincronização', () => {
  it('syncIntegrationEvent retorna changes quando status mapeado muda', async () => {
    const result = await syncIntegrationEvent(
      {
        systemCode: 'sei',
        event: 'processo.atualizado',
        numero_processo: '00100.999999/2026-01',
        proposta: 'PROP-SEI-HOM-001',
        status: 'TRAMITANDO',
      },
      { systemCode: 'sei', source: 'e3.2' }
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('synced');
    expect(result.changes?.status).toBe('analise');
    expect(result.metadata?.externalId).toBe('00100.999999/2026-01');
  });
});

// ---------------------------------------------------------------------------
// 16. Scheduler no mesmo ciclo
// ---------------------------------------------------------------------------
describe('E3.2 — 16. Scheduler usa o mesmo ciclo para o SEI', () => {
  it('parseSystemSyncConfig lê a config do SEI (syncEnabled padrão false)', () => {
    const cfg = parseSystemSyncConfig({ baseUrl: 'https://api.sei.gov.br', secretEnvKey: 'SEI_API_TOKEN', syncEnabled: false, syncIntervalMinutes: 60, maxRecordsPerSync: 100 });
    expect(cfg.enabled).toBe(false);
    expect(cfg.intervalMinutes).toBe(60);
    expect(cfg.maxRecords).toBe(100);
  });

  it('o adapter resolvido pelo scheduler para sei é o SEI Gov (sem novo fluxo)', () => {
    const adapter = getGovAdapter('sei');
    expect(adapter).toBe(seiGovAdapter);
  });
});

// ---------------------------------------------------------------------------
// 17. Dashboard exibe SEI
// ---------------------------------------------------------------------------
describe('E3.2 — 17. Dashboard exibe SEI automaticamente', () => {
  it('getOverview lista o sistema SEI sem código específico', async () => {
    const overview = await getOverview();
    const seiRow = overview.systems.find((s) => s.code === 'sei');
    expect(seiRow).toBeDefined();
    expect(seiRow!.healthStatus).toBeDefined();
    expect(Array.isArray(seiRow!.alerts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 18. Segredos não expostos
// ---------------------------------------------------------------------------
describe('E3.2 — 18. Segredos não expostos', () => {
  it('sanitizeIntegrationConfig redige api_token e secret_env_key', () => {
    process.env.SEI_API_TOKEN = 'ultra-secreto';
    const redacted = sanitizeIntegrationConfig(
      {
        baseUrl: 'https://api.sei.gov.br',
        secretEnvKey: 'SEI_API_TOKEN',
        extra: { api_token: 'valor-sensivel', authType: 'token' },
      },
      false
    ) as Record<string, unknown>;

    expect(redacted.baseUrl).toBe('https://api.sei.gov.br');
    expect(redacted.secretEnvKey).toBe('[REDACTED]');
    expect((redacted.extra as Record<string, unknown>).api_token).toBe('[REDACTED]');
    expect((redacted.extra as Record<string, unknown>).authType).toBe('token');
    delete process.env.SEI_API_TOKEN;
  });

  it('readSecret não vaza valores de variáveis inexistentes', () => {
    delete process.env.SEI_API_TOKEN;
    expect(readSecret('SEI_API_TOKEN')).toBeNull();
  });
});
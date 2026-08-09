/**
 * Fase E3.3 — Homologação e Produção (CGLOG)
 *
 * Cobre os cenários operacionais exigidos para levar a integração com o CGLOG
 * ao mesmo ciclo operacional do Transferegov e SEI (mesma arquitetura,
 * observabilidade, auditoria e operação administrativa — sem fluxo paralelo):
 *  1. Registro do adapter;
 *  2. Autenticação bem-sucedida (token);
 *  3. Falha de autenticação (sem secret);
 *  4. Fetch por protocolo (endpoint + header);
 *  5. Validação de protocolo válido;
 *  6. Validação de payload inválido (sem protocolo nem proposta);
 *  7. Normalização de payload completo;
 *  8. Payload incompleto (comportamento defensivo);
 *  9. API indisponível (HTTP 0) → R10 api_unavailable;
 * 10. Rate limit (HTTP 429) → retry do httpClient;
 * 11. Sincronização completa com sucesso;
 * 12. Deduplicação (reprocessamento);
 * 13. Persistência (processor → demandas, timeline, vínculo);
 * 14. Auditoria (audit_logs integration_sync);
 * 15. Evento de sincronização / mudança de status;
 * 16. Scheduler resolve CGLOG no mesmo ciclo;
 * 17. Dashboard exibe CGLOG automaticamente;
 * 18. Segredos não expostos (redact).
 *
 * O httpClient usa o `fetch` global, então mockamos fetch para simular respostas.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { get, run, all } from '../database.js';
import { cglogAdapter, cglogGovAdapter } from '../integrations/cglog.adapter.js';
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
    code: 'cglog',
    name: 'CGLOG',
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

let cglogId: number;
let demandId: string;
const testEventIds: number[] = [];

async function insertCglogEvent(payload: unknown, status = 'pending'): Promise<number> {
  if (cglogId === undefined) throw new Error('cglogId não inicializado');
  const res = await run(
    `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, status)
     VALUES ($1, $2, 'evento.atualizado', $3, $4::jsonb, $5)
     RETURNING id`,
    [
      cglogId,
      'cglog',
      `cglog-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      JSON.stringify(payload),
      status,
    ]
  );
  return res.rows[0].id as number;
}

beforeAll(async () => {
  process.env.CGLOG_API_TOKEN = 'cglog-token-homolog-123';

  const cglog = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', ['cglog']);
  if (!cglog) throw new Error('Sistema cglog não seedado');
  cglogId = cglog.id;

  const res = await run(
    `INSERT INTO demands (id, title, category, municipality, uf, status, priority, proposal_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [`CGLOG-HOM-${Date.now()}`, 'DEMANDA CGLOG HOMOLOG', 'INTEGRACAO', 'FORTALEZA', 'CE', 'pendente', 'media', 'PROP-CGLOG-HOM-001']
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
describe('E3.3 — 1. Registro do adapter CGLOG', () => {
  it('getGovAdapter resolve o CGLOG e está registrado na lista', () => {
    expect(getGovAdapter('cglog')).toBe(cglogGovAdapter);
    expect(hasGovAdapter('cglog')).toBe(true);
  });

  it('adapter síncrono e governamental compartilham o mesmo system code', () => {
    expect(cglogAdapter.system).toBe('cglog');
    expect(cglogGovAdapter.system).toBe('cglog');
  });
});

// ---------------------------------------------------------------------------
// 2–3. Autenticação
// ---------------------------------------------------------------------------
describe('E3.3 — Autenticação (2–3)', () => {
  it('2. token retornado quando secret_env_key aponta para env configurada', async () => {
    process.env.CGLOG_API_TOKEN = 'token-cglog-456';
    const cred = await cglogGovAdapter.authenticate({ secretEnvKey: 'CGLOG_API_TOKEN' });
    expect(cred).toBe('token-cglog-456');
    delete process.env.CGLOG_API_TOKEN;
  });

  it('3. retorna null sem secret (modo degradado)', async () => {
    delete process.env.CGLOG_API_TOKEN;
    const cred = await cglogGovAdapter.authenticate({ secretEnvKey: 'CGLOG_API_TOKEN' });
    expect(cred).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Fetch por protocolo
// ---------------------------------------------------------------------------
describe('E3.3 — 4. Fetch por protocolo', () => {
  it('monta o endpoint /api/v1/eventos?protocolo=... e envia X-Auth-Token', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ protocolo: 'CGLOG-2026-001', status: 'EM_ANALISE' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await cglogGovAdapter.fetch(
      { baseUrl: 'https://api.cglog.gov.br', secretEnvKey: 'CGLOG_API_TOKEN', extra: { authType: 'token' } },
      'credencial-teste',
      { protocol: 'CGLOG-2026-001' }
    );

    expect(result.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/v1/eventos?protocolo=CGLOG-2026-001');
    expect((init?.headers as Record<string, string>)['X-Auth-Token']).toBe('credencial-teste');

    mockFetch.mockRestore();
  });

  it('sem baseUrl retorna status 0', async () => {
    const result = await cglogGovAdapter.fetch({}, null, {});
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5–6. Validação
// ---------------------------------------------------------------------------
describe('E3.3 — Validação (5–6)', () => {
  it('5. payload com protocolo válido passa na validação', () => {
    expect(cglogGovAdapter.validate({ protocolo: 'CGLOG-2026-001', status: 'EM_ANALISE' })).toBe(true);
  });

  it('6. payload sem protocolo nem proposta é rejeitado', () => {
    const result = cglogGovAdapter.validate({ status: 'EM_ANALISE', descricao: 'teste' });
    expect(typeof result).toBe('string');
    expect(result).toContain('protocolo');
  });
});

// ---------------------------------------------------------------------------
// 7–8. Normalização
// ---------------------------------------------------------------------------
describe('E3.3 — Normalização (7–8)', () => {
  it('7. payload completo extrai protocolo, proposta, status e prazo', () => {
    const evt = cglogAdapter.normalize({
      event: 'evento.atualizado',
      protocolo: 'CGLOG-2026-001',
      proposta: 'PROP-CGLOG-HOM-001',
      status: 'EM_ANALISE',
      prazo: '2026-09-30',
    });
    expect(evt.externalId).toBe('CGLOG-2026-001');
    expect(evt.proposalNumber).toBe('PROP-CGLOG-HOM-001');
    expect(evt.externalStatus).toBe('EM_ANALISE');
    expect(evt.deadline).toBe('2026-09-30T00:00:00.000Z');
  });

  it('8. payload incompleto não lança e retorna campos opcionais undefined', () => {
    const evt = cglogAdapter.normalize({ event: 'evento.atualizado' });
    expect(evt.systemCode).toBe('cglog');
    expect(evt.proposalNumber).toBeUndefined();
    expect(evt.externalId).toBeUndefined();
    expect(evt.externalStatus).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. API indisponível (HTTP 0) → R10
// ---------------------------------------------------------------------------
describe('E3.3 — 9. API indisponível (R10 api_unavailable)', () => {
  it('evaluateRules dispara api_unavailable em HTTP 0', () => {
    const m = evaluateRules(snap({ lastHttpStatus: 0 }), CTX).find((x) => x.type === 'api_unavailable');
    expect(m).toBeDefined();
    expect(m!.severity).toBe('critical');
  });

  it('sync com HTTP 0 retorna falha estruturada e httpStatus 0', async () => {
    const result = await cglogGovAdapter.sync({}, {});
    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Rate limit (429) → retry
// ---------------------------------------------------------------------------
describe('E3.3 — 10. Rate limit (429) e retry', () => {
  it('429 dispara retry e eventual sucesso retorna 200', async () => {
    let calls = 0;
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify([{ protocolo: 'CGLOG-2026-001', status: 'EM_ANALISE' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const result = await httpClient(
      { baseUrl: 'https://api.cglog.gov.br', retryBaseDelayMs: 1 },
      { url: 'https://api.cglog.gov.br/api/v1/eventos', method: 'GET' }
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
      { baseUrl: 'https://api.cglog.gov.br', maxRetries: 1, retryBaseDelayMs: 1 },
      { url: 'https://api.cglog.gov.br/api/v1/eventos', method: 'GET' }
    );

    mockFetch.mockRestore();

    expect(result.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 11. Sincronização completa
// ---------------------------------------------------------------------------
describe('E3.3 — 11. Sincronização completa', () => {
  it('fluxo completo com HTTP 200 normaliza e retorna sucesso', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { protocolo: 'CGLOG-2026-001', proposta: 'PROP-CGLOG-HOM-001', status: 'EM_ANALISE', prazo: '2026-12-31' },
          { protocolo: 'CGLOG-2026-002', status: 'CONCLUIDO' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await cglogGovAdapter.sync(
      { baseUrl: 'https://api.cglog.gov.br', secretEnvKey: 'CGLOG_API_TOKEN' },
      {}
    );

    mockFetch.mockRestore();

    expect(result.success).toBe(true);
    expect(result.fetchedCount).toBe(2);
    expect(result.normalizedCount).toBe(2);
    expect(result.events[0].externalId).toBe('CGLOG-2026-001');
    expect(result.events[0].externalStatus).toBe('EM_ANALISE');
  });
});

// ---------------------------------------------------------------------------
// 12. Deduplicação (persistência revisitada)
// ---------------------------------------------------------------------------
describe('E3.3 — 12. Reprocessamento/deduplicação', () => {
  it('processWebhookEvent reexecutado retorna already_processed', async () => {
    const eventId = await insertCglogEvent({
      protocolo: 'CGLOG-2026-001',
      proposta: 'PROP-CGLOG-HOM-001',
      status: 'EM_ANALISE',
    });
    testEventIds.push(eventId);

    const first = await processWebhookEvent(eventId, { triggeredBy: 'e3.3' });
    expect(first).toEqual({ success: true, status: 'processed' });

    const second = await processWebhookEvent(eventId, { triggeredBy: 'e3.3' });
    expect(second).toEqual({ success: true, status: 'processed', reason: 'already_processed' });
  });

  it('findDemandByProposalNumber localiza a demanda CGLOG', async () => {
    const demand = await findDemandByProposalNumber('PROP-CGLOG-HOM-001');
    expect(demand?.id).toBe(demandId);
  });
});

// ---------------------------------------------------------------------------
// 13. Persistência
// ---------------------------------------------------------------------------
describe('E3.3 — 13. Persistência', () => {
  it('webhook CGLOG atualiza demanda, timeline e vínculo', async () => {
    const eventId = await insertCglogEvent({
      protocolo: 'CGLOG-2026-777',
      proposta: 'PROP-CGLOG-HOM-001',
      status: 'EM_ANALISE',
    });
    testEventIds.push(eventId);

    const result = await processWebhookEvent(eventId, { triggeredBy: 'e3.3' });
    expect(result).toEqual({ success: true, status: 'processed' });

    const demand = await get<{ status: string }>('SELECT status FROM demands WHERE id = $1', [demandId]);
    expect(demand?.status).toBe('analise');

    const event = await get<{ status: string }>('SELECT status FROM webhook_events WHERE id = $1', [eventId]);
    expect(event?.status).toBe('processed');

    const timeline = await all('SELECT * FROM timeline_events WHERE demand_id = $1', [demandId]);
    expect(timeline.length).toBeGreaterThan(0);

    const link = await get('SELECT * FROM demand_integrations WHERE demand_id = $1 AND system_id = $2', [demandId, cglogId]);
    expect(link).toBeTruthy();
    expect(link.external_id).toBe('CGLOG-2026-777');
  });
});

// ---------------------------------------------------------------------------
// 14. Auditoria
// ---------------------------------------------------------------------------
describe('E3.3 — 14. Auditoria', () => {
  it('processamento CGLOG registra audit_logs integration_sync', async () => {
    const eventId = await insertCglogEvent({
      protocolo: 'CGLOG-2026-888',
      proposta: 'PROP-CGLOG-HOM-001',
      status: 'CONCLUIDO',
    });
    testEventIds.push(eventId);

    await processWebhookEvent(eventId, { triggeredBy: 'e3.3' });

    const audit = await get(
      `SELECT * FROM audit_logs
       WHERE entity_type = 'demand' AND entity_id = $1 AND action = 'integration_sync'
       ORDER BY created_at DESC LIMIT 1`,
      [demandId]
    );
    expect(audit).toBeTruthy();
    expect(audit.details?.system).toBe('cglog');
  });
});

// ---------------------------------------------------------------------------
// 15. Evento de sincronização / mudança de status
// ---------------------------------------------------------------------------
describe('E3.3 — 15. Evento de sincronização', () => {
  it('syncIntegrationEvent retorna changes quando status mapeado muda', async () => {
    const result = await syncIntegrationEvent(
      {
        systemCode: 'cglog',
        event: 'evento.atualizado',
        protocolo: 'CGLOG-2026-999',
        proposta: 'PROP-CGLOG-HOM-001',
        status: 'EM_ANALISE',
      },
      { systemCode: 'cglog', source: 'e3.3' }
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('synced');
    expect(result.changes?.status).toBe('analise');
    expect(result.metadata?.externalId).toBe('CGLOG-2026-999');
  });
});

// ---------------------------------------------------------------------------
// 16. Scheduler no mesmo ciclo
// ---------------------------------------------------------------------------
describe('E3.3 — 16. Scheduler usa o mesmo ciclo para o CGLOG', () => {
  it('parseSystemSyncConfig lê a config do CGLOG (syncEnabled padrão false)', () => {
    const cfg = parseSystemSyncConfig({ baseUrl: 'https://api.cglog.gov.br', secretEnvKey: 'CGLOG_API_TOKEN', syncEnabled: false, syncIntervalMinutes: 60, maxRecordsPerSync: 100 });
    expect(cfg.enabled).toBe(false);
    expect(cfg.intervalMinutes).toBe(60);
    expect(cfg.maxRecords).toBe(100);
  });

  it('o adapter resolvido pelo scheduler para cglog é o CGLOG Gov (sem novo fluxo)', () => {
    const adapter = getGovAdapter('cglog');
    expect(adapter).toBe(cglogGovAdapter);
  });
});

// ---------------------------------------------------------------------------
// 17. Dashboard exibe CGLOG
// ---------------------------------------------------------------------------
describe('E3.3 — 17. Dashboard exibe CGLOG automaticamente', () => {
  it('getOverview lista o sistema CGLOG sem código específico', async () => {
    const overview = await getOverview();
    const cglogRow = overview.systems.find((s) => s.code === 'cglog');
    expect(cglogRow).toBeDefined();
    expect(cglogRow!.healthStatus).toBeDefined();
    expect(Array.isArray(cglogRow!.alerts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 18. Segredos não expostos
// ---------------------------------------------------------------------------
describe('E3.3 — 18. Segredos não expostos', () => {
  it('sanitizeIntegrationConfig redige api_token e secret_env_key', () => {
    process.env.CGLOG_API_TOKEN = 'ultra-secreto';
    const redacted = sanitizeIntegrationConfig(
      {
        baseUrl: 'https://api.cglog.gov.br',
        secretEnvKey: 'CGLOG_API_TOKEN',
        extra: { api_token: 'valor-sensivel', authType: 'token' },
      },
      false
    ) as Record<string, unknown>;

    expect(redacted.baseUrl).toBe('https://api.cglog.gov.br');
    expect(redacted.secretEnvKey).toBe('[REDACTED]');
    expect((redacted.extra as Record<string, unknown>).api_token).toBe('[REDACTED]');
    expect((redacted.extra as Record<string, unknown>).authType).toBe('token');
    delete process.env.CGLOG_API_TOKEN;
  });

  it('readSecret não vaza valores de variáveis inexistentes', () => {
    delete process.env.CGLOG_API_TOKEN;
    expect(readSecret('CGLOG_API_TOKEN')).toBeNull();
  });
});

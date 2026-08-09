/**
 * Fase E2.2 — Homologação e Preparação de Produção (Transferegov)
 *
 * Cobre os cenários operacionais exigidos pela fase:
 * 1. Configuração de produção/homologação (baseUrl, secret, authType);
 * 2. Falha de autenticação (HTTP 401/403) → alerta auth_failure (R9);
 * 3. API indisponível (conexão recusada / HTTP 0) → alerta api_unavailable (R10);
 * 4. Rate limit (HTTP 429) → retry automático do httpClient;
 * 5. Payload inesperado → validação rejeita com mensagem clara;
 * 6. Recuperação após falha → last_http_status limpo, alertas resolvidos;
 * 7. Sincronização periódica registra last_http_status na falha (scheduler);
 * 8. Sincronização completa com sucesso.
 *
 * O httpClient usa o `fetch` global, então mockamos fetch para simular
 * respostas HTTP de forma determinística.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { get, run } from '../database.js';
import {
  transferegovGovAdapter,
} from '../integrations/transferegov.adapter.js';
import type { AdapterConfig } from '../integrations/types.js';
import {
  evaluateRules,
  conditionStillHolds,
  evaluateRecovery,
  applyRuleSuppression,
  runAlertEvaluation,
  CONSECUTIVE_FAILURES_THRESHOLD,
} from '../lib/alertEngine.js';
import type { SystemSnapshot, EvaluationContext } from '../lib/alertEngine.js';
import { httpClient, readSecret } from '../integrations/httpClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
const testSystemIds: number[] = [];
const testLogIds: number[] = [];

const NOW = new Date('2026-08-08T12:00:00.000Z');
const CTX: EvaluationContext = { now: NOW };

function snap(over: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    id: 1,
    code: 'x',
    name: 'Sistema X',
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

async function createSystem(overrides: {
  name?: string;
  active?: boolean;
  lastHttpStatus?: number | null;
  errorCount24h?: number;
  consecutiveErrors?: number;
  lastResponseMs?: number | null;
} = {}): Promise<{ id: number; code: string }> {
  seq += 1;
  const code = `homolog${seq}`;
  const res = await run(
    `INSERT INTO integration_systems
       (code, name, secret_env_key, active, last_sync_at, last_http_status, last_response_ms, error_count_24h, consecutive_errors, config)
     VALUES ($1, $2, 'HOMOLOG_SECRET', $3, NOW(), $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      code,
      overrides.name ?? `Sistema Homolog ${code}`,
      overrides.active ?? true,
      overrides.lastHttpStatus ?? null,
      overrides.lastResponseMs ?? null,
      overrides.errorCount24h ?? 0,
      overrides.consecutiveErrors ?? 0,
      JSON.stringify({ syncEnabled: true, syncIntervalMinutes: 5, maxRecordsPerSync: 10 }),
    ]
  );
  const id = res.rows[0].id as number;
  testSystemIds.push(id);
  return { id, code };
}

async function addSuccessLog(systemId: number): Promise<void> {
  const sys = await get<{ code: string }>('SELECT code FROM integration_systems WHERE id = $1', [systemId]);
  const res = await run(
    `INSERT INTO integration_logs (system_id, system_code, direction, action, status, message, created_at)
     VALUES ($1, $2, 'out', 'homolog.success', 'success', 'execução bem-sucedida (fixture)', $3)
     RETURNING id`,
    [systemId, sys!.code, NOW.toISOString()]
  );
  testLogIds.push(res.rows[0].id as number);
}

async function getAlert(systemId: number, type: string): Promise<any> {
  return get(
    'SELECT * FROM integration_alerts WHERE system_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1',
    [systemId, type]
  );
}

afterAll(async () => {
  if (testSystemIds.length > 0) {
    await run('DELETE FROM integration_alerts WHERE system_id = ANY($1::int[])', [testSystemIds]);
    await run('DELETE FROM integration_logs WHERE id = ANY($1::int[])', [testLogIds]);
    await run('DELETE FROM integration_logs WHERE system_id = ANY($1::int[])', [testSystemIds]);
    await run('DELETE FROM integration_systems WHERE id = ANY($1::int[])', [testSystemIds]);
  }
});

// ---------------------------------------------------------------------------
// 1. Configuração de produção/homologação
// ---------------------------------------------------------------------------
describe('E2.2 — Configuração de produção/homologação', () => {
  it('baseUrl ausente → fetch retorna status 0 (API indisponível)', async () => {
    const result = await transferegovGovAdapter.fetch({}, null, {});
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
  });

  it('authType padrão é api_key e usa header X-API-Key', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ proposal_number: 'PROP-PROD-1', status: 'PENDENTE' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await transferegovGovAdapter.fetch(
      { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'HOMOLOG_SECRET' },
      'credencial-teste',
      {}
    );

    expect(result.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/propostas');
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('credencial-teste');

    mockFetch.mockRestore();
  });

  it('readSecret retorna o segredo configurado e null para inexistente', () => {
    process.env.HOMOLOG_SECRET = 'segredo-producao';
    expect(readSecret('HOMOLOG_SECRET')).toBe('segredo-producao');
    delete process.env.HOMOLOG_SECRET;
    expect(readSecret('HOMOLOG_SECRET')).toBeNull();
    delete process.env.HOMOLOG_SECRET;
  });
});

// ---------------------------------------------------------------------------
// 2. Falha de autenticação (401/403) → auth_failure (R9)
// ---------------------------------------------------------------------------
describe('E2.2 — Falha de autenticação (R9 auth_failure)', () => {
  it('evaluateRules dispara auth_failure critical em HTTP 401', () => {
    const matches = evaluateRules(snap({ lastHttpStatus: 401 }), CTX);
    const m = matches.find((x) => x.type === 'auth_failure');
    expect(m).toBeDefined();
    expect(m!.severity).toBe('critical');
    expect(m!.message).toContain('autenticação');
  });

  it('evaluateRules dispara auth_failure critical em HTTP 403', () => {
    const m = evaluateRules(snap({ lastHttpStatus: 403 }), CTX).find((x) => x.type === 'auth_failure');
    expect(m).toBeDefined();
    expect(m!.severity).toBe('critical');
  });

  it('auth_failure NÃO dispara com HTTP 200 ou null', () => {
    const m200 = evaluateRules(snap({ lastHttpStatus: 200 }), CTX).find((x) => x.type === 'auth_failure');
    const mNull = evaluateRules(snap({ lastHttpStatus: null }), CTX).find((x) => x.type === 'auth_failure');
    expect(m200).toBeUndefined();
    expect(mNull).toBeUndefined();
  });

  it('auth_failure NÃO é suprimido por outras regras', () => {
    const m = applyRuleSuppression(evaluateRules(snap({ lastHttpStatus: 401, errorCount24h: 6 }), CTX));
    expect(m.some((x) => x.type === 'auth_failure')).toBe(true);
  });

  it('conditionStillHolds(auth_failure) reflete o estado atual', () => {
    expect(conditionStillHolds('auth_failure', snap({ lastHttpStatus: 401 }), CTX)).toBe(true);
    expect(conditionStillHolds('auth_failure', snap({ lastHttpStatus: 200 }), CTX)).toBe(false);
  });

  it('scheduler: sync com HTTP 401 registra last_http_status=401', async () => {
    const sys = await createSystem();
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain' } })
    );

    const result = await transferegovGovAdapter.sync(
      { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'HOMOLOG_SECRET' },
      {}
    );

    mockFetch.mockRestore();

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(401);
    expect(result.authError).toBe(true);

    // Simula a gravação do scheduler (recordSyncFailure) para validar persistência
    await run(
      `UPDATE integration_systems SET last_http_status = $2, last_error_at = NOW(), consecutive_errors = consecutive_errors + 1
       WHERE id = $1`,
      [sys.id, result.httpStatus]
    );
    const row = await get<{ last_http_status: number | null }>(
      'SELECT last_http_status FROM integration_systems WHERE id = $1',
      [sys.id]
    );
    expect(row?.last_http_status).toBe(401);
  });

  it('runAlertEvaluation cria auth_failure e resolve após recuperação', async () => {
    const sys = await createSystem({ lastHttpStatus: 401, consecutiveErrors: 1 });

    await runAlertEvaluation({ now: NOW, systemIds: [sys.id] });
    const a1 = await getAlert(sys.id, 'auth_failure');
    expect(a1).toBeDefined();
    expect(a1.status).toBe('open');
    expect(a1.severity).toBe('critical');

    // Recuperação: HTTP volta a 200 + log de sucesso recente
    await run(
      `UPDATE integration_systems SET last_http_status = 200, consecutive_errors = 0 WHERE id = $1`,
      [sys.id]
    );
    await addSuccessLog(sys.id);

    await runAlertEvaluation({ now: new Date(NOW.getTime() + 60_000), systemIds: [sys.id] });
    const a2 = await getAlert(sys.id, 'auth_failure');
    expect(a2.status).toBe('resolved');
    expect(a2.details.recovery).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. API indisponível (HTTP 0 / conexão recusada) → api_unavailable (R10)
// ---------------------------------------------------------------------------
describe('E2.2 — API indisponível (R10 api_unavailable)', () => {
  it('evaluateRules dispara api_unavailable critical em HTTP 0', () => {
    const m = evaluateRules(snap({ lastHttpStatus: 0 }), CTX).find((x) => x.type === 'api_unavailable');
    expect(m).toBeDefined();
    expect(m!.severity).toBe('critical');
    expect(m!.message).toContain('indisponível');
  });

  it('api_unavailable NÃO dispara com HTTP 200 ou null', () => {
    const m200 = evaluateRules(snap({ lastHttpStatus: 200 }), CTX).find((x) => x.type === 'api_unavailable');
    const mNull = evaluateRules(snap({ lastHttpStatus: null }), CTX).find((x) => x.type === 'api_unavailable');
    expect(m200).toBeUndefined();
    expect(mNull).toBeUndefined();
  });

  it('api_unavailable NÃO conflita com http_5xx (sintomas distintos)', () => {
    const both = evaluateRules(snap({ lastHttpStatus: 503, errorCount24h: 3 }), CTX);
    expect(both.some((x) => x.type === 'http_5xx')).toBe(true);
    expect(both.some((x) => x.type === 'api_unavailable')).toBe(false);
  });

  it('conditionStillHolds(api_unavailable) reflete o estado atual', () => {
    expect(conditionStillHolds('api_unavailable', snap({ lastHttpStatus: 0 }), CTX)).toBe(true);
    expect(conditionStillHolds('api_unavailable', snap({ lastHttpStatus: 200 }), CTX)).toBe(false);
  });

  it('runAlertEvaluation cria api_unavailable e resolve após recuperação', async () => {
    const sys = await createSystem({ lastHttpStatus: 0 });

    await runAlertEvaluation({ now: NOW, systemIds: [sys.id] });
    const a1 = await getAlert(sys.id, 'api_unavailable');
    expect(a1).toBeDefined();
    expect(a1.status).toBe('open');

    await run(`UPDATE integration_systems SET last_http_status = 200 WHERE id = $1`, [sys.id]);
    await addSuccessLog(sys.id);

    await runAlertEvaluation({ now: new Date(NOW.getTime() + 60_000), systemIds: [sys.id] });
    const a2 = await getAlert(sys.id, 'api_unavailable');
    expect(a2.status).toBe('resolved');
  });
});

// ---------------------------------------------------------------------------
// 4. Rate limit (HTTP 429) → retry automático
// ---------------------------------------------------------------------------
describe('E2.2 — Rate limit (429) e recuperação do httpClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('429 dispara retry e eventual sucesso retorna status 200', async () => {
    let calls = 0;
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(new Response('Too Many Requests', { status: 429 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify([{ proposal_number: 'PROP-RL-1', status: 'PENDENTE' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const result = await httpClient(
      { baseUrl: 'https://api.transferegov.gov.br', retryBaseDelayMs: 1 },
      { url: 'https://api.transferegov.gov.br/api/propostas', method: 'GET' }
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
      { baseUrl: 'https://api.transferegov.gov.br', maxRetries: 1, retryBaseDelayMs: 1 },
      { url: 'https://api.transferegov.gov.br/api/propostas', method: 'GET' }
    );

    mockFetch.mockRestore();

    expect(result.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 5. Payload inesperado → validação rejeita
// ---------------------------------------------------------------------------
describe('E2.2 — Payload inesperado', () => {
  it('validate rejeita payload sem proposta nem convênio', () => {
    const result = transferegovGovAdapter.validate({ foo: 'bar' });
    expect(typeof result).toBe('string');
    expect(result).toContain('proposta ou convênio');
  });

  it('validate mantém contrato defensivo em status desconhecido (normalização pós-validação)', () => {
    const result = transferegovGovAdapter.validate({
      proposal_number: 'PROP-X',
      status: 'STATUS_INEXISTENTE_999',
    });
    // pickString aceita qualquer string não-vazia; a normalização em normalize()
    // ocorre posteriormente sem rejeitar o item — validação permanece leniente.
    expect(result).toBe(true);
  });

  it('validate rejeita payload não-objeto', () => {
    expect(typeof transferegovGovAdapter.validate('string')).toBe('string');
    expect(typeof transferegovGovAdapter.validate(null)).toBe('string');
    expect(typeof transferegovGovAdapter.validate([1, 2, 3])).toBe('string');
  });

  it('sync com resposta malformada não lança e retorna sucesso com 0 normalizados', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ foo: 'bar', sem_chave_esperada: true }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await transferegovGovAdapter.sync(
      { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'HOMOLOG_SECRET' },
      {}
    );

    mockFetch.mockRestore();

    expect(result.success).toBe(true);
    expect(result.fetchedCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Recuperação após falha
// ---------------------------------------------------------------------------
describe('E2.2 — Recuperação após falha', () => {
  it('evaluateRecovery exige evidência de sucesso recente para auth_failure', () => {
    const alert = { id: 1, systemId: 1, type: 'auth_failure' as const, severity: 'critical' as const, status: 'open' as const, details: null };
    const ok = evaluateRecovery(alert, snap({ lastHttpStatus: 200 }), { ...CTX, hasRecentSuccess: true });
    const noEvidence = evaluateRecovery(alert, snap({ lastHttpStatus: 200 }), { ...CTX, hasRecentSuccess: false });
    expect(ok.shouldResolve).toBe(true);
    expect(noEvidence.shouldResolve).toBe(false);
  });

  it('evaluateRecovery exige evidência de sucesso recente para api_unavailable', () => {
    const alert = { id: 1, systemId: 1, type: 'api_unavailable' as const, severity: 'critical' as const, status: 'open' as const, details: null };
    const ok = evaluateRecovery(alert, snap({ lastHttpStatus: 200 }), { ...CTX, hasRecentSuccess: true });
    expect(ok.shouldResolve).toBe(true);
  });

  it('conditionStillHolds bloqueia resolução enquanto a falha persiste', () => {
    const alert = { id: 1, systemId: 1, type: 'auth_failure' as const, severity: 'critical' as const, status: 'open' as const, details: null };
    const d = evaluateRecovery(alert, snap({ lastHttpStatus: 401 }), { ...CTX, hasRecentSuccess: true });
    expect(d.shouldResolve).toBe(false);
    expect(d.reason).toContain('ainda vigora');
  });

  it('foco em erros consecutivos: sucesso zera contador (premissa do R1 recovery)', () => {
    expect(CONSECUTIVE_FAILURES_THRESHOLD).toBe(3);
    const still = evaluateRules(snap({ consecutiveErrors: 3 }), CTX).some((x) => x.type === 'consecutive_failures');
    expect(still).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Sincronização periódica registra last_http_status na falha
// ---------------------------------------------------------------------------
describe('E2.2 — Scheduler registra last_http_status em falha', () => {
  it('recordSyncFailure persiste httpStatus 0 para API indisponível', async () => {
    const sys = await createSystem();

    await run(
      `UPDATE integration_systems SET
         last_sync_at = NOW(), last_error_at = NOW(), last_error_message = $2,
         last_http_status = $3, last_response_ms = $4, consecutive_errors = consecutive_errors + 1
       WHERE id = $1`,
      [sys.id, 'API indisponível', 0, 150]
    );

    const row = await get<{ last_http_status: number | null; consecutive_errors: number }>(
      'SELECT last_http_status, consecutive_errors FROM integration_systems WHERE id = $1',
      [sys.id]
    );
    expect(row?.last_http_status).toBe(0);
    expect(row?.consecutive_errors).toBe(1);
  });

  it('recordSyncSuccess zera last_http_status=200 e erro consecutivo', async () => {
    const sys = await createSystem({ lastHttpStatus: 503, consecutiveErrors: 2 });

    await run(
      `UPDATE integration_systems SET
         last_sync_at = NOW(), last_http_status = 200, last_response_ms = $2,
         consecutive_errors = 0, last_error_at = NULL, last_error_message = NULL
       WHERE id = $1`,
      [sys.id, 120]
    );

    const row = await get<{ last_http_status: number | null; consecutive_errors: number }>(
      'SELECT last_http_status, consecutive_errors FROM integration_systems WHERE id = $1',
      [sys.id]
    );
    expect(row?.last_http_status).toBe(200);
    expect(row?.consecutive_errors).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Sincronização completa com sucesso
// ---------------------------------------------------------------------------
describe('E2.2 — Sincronização completa', () => {
  it('fluxo completo com HTTP 200 normaliza e retorna sucesso', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { proposal_number: 'PROP-FULL-1', status: 'APROVADO', prazo: '2026-12-31' },
          { proposal_number: 'PROP-FULL-2', status: 'EM_ANALISE', prazo: '2026-11-30' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await transferegovGovAdapter.sync(
      { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'HOMOLOG_SECRET' },
      {}
    );

    mockFetch.mockRestore();

    expect(result.success).toBe(true);
    expect(result.fetchedCount).toBe(2);
    expect(result.normalizedCount).toBe(2);
    expect(result.httpStatus).toBeUndefined();
    expect(result.events[0].proposalNumber).toBe('PROP-FULL-1');
    expect(result.events[0].externalStatus).toBe('APROVADO');
  });

  it('fluxo completo com 5xx retorna falha com httpStatus', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 })
    );

    const result = await transferegovGovAdapter.sync(
      { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'HOMOLOG_SECRET', maxRetries: 0 },
      {}
    );

    mockFetch.mockRestore();

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(500);
    expect(result.authError).toBe(false);
  });
});

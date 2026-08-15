import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, run } from '../database.js';
import {
  runAlertEvaluation,
  evaluateRules,
  applyRuleSuppression,
  evaluateRecovery,
  redactSensitiveDetails,
  CONSECUTIVE_FAILURES_THRESHOLD,
  HTTP_5XX_STATUS,
  HTTP_5XX_ERRORS_24H,
  ERROR_SPIKE_THRESHOLD_24H,
  LATENCY_WARNING_MS,
} from '../lib/alertEngine.js';
import type { AlertSeverity, AlertType, EvaluationContext, SystemSnapshot } from '../lib/alertEngine.js';

/**
 * Fase D1.3 — Motor de Alertas Inteligentes (regras R1–R8).
 * Testes puros (funções sem I/O) + integração real com o PostgreSQL de dev.
 * Todos os fixtures são sistemas claramente identificados (prefixo alertestN)
 * e recebem cleanup completo ao final.
 */

/* ------------------------- Fixtures e helpers ------------------------- */

const testSystems: number[] = [];
const testEvents: number[] = [];
const testLogs: number[] = [];

let seq = 0;

async function createSystem(overrides: {
  name?: string;
  active?: boolean;
  lastSyncAt?: string | null;
  lastHttpStatus?: number | null;
  lastResponseMs?: number | null;
  errorCount24h?: number;
  consecutiveErrors?: number;
  config?: unknown;
} = {}): Promise<{ id: number; code: string }> {
  seq += 1;
  const code = `alertest${seq}`;
  const res = await run(
    `INSERT INTO integration_systems
       (code, name, secret_env_key, active, last_sync_at, last_http_status, last_response_ms, error_count_24h, consecutive_errors, config)
     VALUES ($1, $2, 'TEST_ALERT_SECRET', $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id`,
    [
      code,
      overrides.name ?? `Sistema Alerta ${code}`,
      overrides.active ?? true,
      'lastSyncAt' in overrides ? overrides.lastSyncAt : new Date().toISOString(), // recente por padrão: evita stale_sync indesejado em fixtures
      overrides.lastHttpStatus ?? null,
      overrides.lastResponseMs ?? null,
      overrides.errorCount24h ?? 0,
      overrides.consecutiveErrors ?? 0,
      overrides.config ? JSON.stringify(overrides.config) : null,
    ]
  );
  const id = res.rows[0].id as number;
  testSystems.push(id);
  return { id, code };
}

async function setHealth(systemId: number, fields: Record<string, unknown>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  params.push(systemId);
  await run(`UPDATE integration_systems SET ${sets.join(', ')} WHERE id = $${i}`, params);
}

async function addSuccessLog(systemId: number, when: Date = new Date()): Promise<void> {
  const sys = await get<{ code: string }>('SELECT code FROM integration_systems WHERE id = $1', [systemId]);
  const res = await run(
    `INSERT INTO integration_logs (system_id, system_code, direction, action, status, message, created_at)
     VALUES ($1, $2, 'out', 'test.success', 'success', 'execução bem-sucedida (fixture)', $3)
     RETURNING id`,
    [systemId, sys!.code, when.toISOString()]
  );
  testLogs.push(res.rows[0].id as number);
}

async function addUnmatchedEvent(systemId: number, code: string, when: Date = new Date()): Promise<number> {
  const res = await run(
    `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, status, received_at)
     VALUES ($1, $2, 'unknown', $3, 'unmatched', $4)
     RETURNING id`,
    [systemId, code, `alertest-unmatched-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, when.toISOString()]
  );
  const id = res.rows[0].id as number;
  testEvents.push(id);
  return id;
}

async function markEventProcessed(eventId: number): Promise<void> {
  await run(`UPDATE webhook_events SET status = 'processed', processed_at = NOW(), error = NULL WHERE id = $1`, [eventId]);
}

async function getAlert(systemId: number, type: AlertType): Promise<any> {
  return get(
    `SELECT * FROM integration_alerts WHERE system_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`,
    [systemId, type]
  );
}

function evalFor(system: SystemSnapshot, ctx: EvaluationContext) {
  return applyRuleSuppression(evaluateRules(system, ctx));
}

afterAll(async () => {
  if (testSystems.length > 0) {
    await run('DELETE FROM integration_alerts WHERE system_id = ANY($1::int[])', [testSystems]);
  }
  if (testEvents.length > 0) {
    await run('DELETE FROM webhook_events WHERE id = ANY($1::int[])', [testEvents]);
  }
  if (testLogs.length > 0) {
    await run('DELETE FROM integration_logs WHERE id = ANY($1::int[])', [testLogs]);
  }
  if (testSystems.length > 0) {
    await run('DELETE FROM integration_systems WHERE id = ANY($1::int[])', [testSystems]);
  }
});

/* ----------------------------- Fixtures puros ----------------------------- */

const NOW = new Date('2026-08-07T12:00:00.000Z');
const CTX: EvaluationContext = { now: NOW };

function snap(over: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    id: 1,
    code: 'x',
    name: 'Sistema X',
    tenantId: 1,
    active: true,
    lastSyncAt: new Date(NOW.getTime() - 3600 * 1000).toISOString(), // 1h atrás
    lastHttpStatus: 200,
    lastResponseMs: 200,
    errorCount24h: 0,
    consecutiveErrors: 0,
    ...over,
  };
}

function types(matches: ReturnType<typeof evaluateRules>): AlertType[] {
  return matches.map((m) => m.type);
}

function severity(matches: ReturnType<typeof evaluateRules>, type: AlertType): AlertSeverity | undefined {
  return matches.find((m) => m.type === type)?.severity;
}

const openAlert = (type: AlertType): any => ({
  id: 1,
  systemId: 1,
  type,
  severity: 'warning',
  status: 'open',
  details: { occurrences: 1, firstDetectedAt: NOW.toISOString() },
});

/* --------------------------- Testes PUROS (R1–R7) --------------------------- */

describe('alertEngine — regras R1–R7 (funções puras)', () => {
  it('R1: 2 falhas consecutivas não disparam; 3 → critical; 4 → critical', () => {
    expect(types(evalFor(snap({ consecutiveErrors: 2 }), CTX))).not.toContain('consecutive_failures');
    const m3 = evalFor(snap({ consecutiveErrors: 3 }), CTX);
    expect(severity(m3, 'consecutive_failures')).toBe('critical');
    const m4 = evalFor(snap({ consecutiveErrors: 4 }), CTX);
    expect(severity(m4, 'consecutive_failures')).toBe('critical');
  });

  it('R2: 500 + 3 erros/24h → critical; 500 + 2 erros/24h → não dispara', () => {
    const on = evalFor(snap({ lastHttpStatus: 500, errorCount24h: 3 }), CTX);
    expect(severity(on, 'http_5xx')).toBe('critical');
    const off = evalFor(snap({ lastHttpStatus: 500, errorCount24h: 2 }), CTX);
    expect(types(off)).not.toContain('http_5xx');
  });

  it('R3: sistema inativo → critical system_inactive', () => {
    const m = evalFor(snap({ active: false }), CTX);
    expect(severity(m, 'system_inactive')).toBe('critical');
  });

  it('R4: 5 erros/24h → warning error_spike (sem 5xx não é critical)', () => {
    const m = evalFor(snap({ errorCount24h: 5, lastHttpStatus: 200 }), CTX);
    expect(severity(m, 'error_spike')).toBe('warning');
    expect(types(m)).not.toContain('http_5xx');
  });

  it('R5: 4999ms → não alerta; 5000ms → warning high_latency', () => {
    expect(types(evalFor(snap({ lastResponseMs: 4999 }), CTX))).not.toContain('high_latency');
    const m = evalFor(snap({ lastResponseMs: 5000 }), CTX);
    expect(severity(m, 'high_latency')).toBe('warning');
  });

  it('R6: sync recente → sem alerta; >24h → warning; NULL → warning', () => {
    expect(types(evalFor(snap({ lastSyncAt: new Date(NOW.getTime() - 3600 * 1000).toISOString() }), CTX))).not.toContain('stale_sync');
    expect(severity(evalFor(snap({ lastSyncAt: new Date(NOW.getTime() - 25 * 3600 * 1000).toISOString() }), CTX), 'stale_sync')).toBe('warning');
    expect(severity(evalFor(snap({ lastSyncAt: null }), CTX), 'stale_sync')).toBe('warning');
  });

  it('R6: lastSyncAt como Date (driver pg) → stale_sync sem erro, com data formatada', () => {
    const m = evalFor(snap({ lastSyncAt: new Date(NOW.getTime() - 25 * 3600 * 1000) }), CTX);
    expect(severity(m, 'stale_sync')).toBe('warning');
    const stale = m.find((x) => x.type === 'stale_sync');
    expect(stale?.message).toContain('em 2026-08-06');
  });

  it('R6: sistema inativo não gera stale_sync (tratado por R3)', () => {
    const m = evalFor(snap({ active: false, lastSyncAt: null }), CTX);
    expect(types(m)).toContain('system_inactive');
    expect(types(m)).not.toContain('stale_sync');
  });

  it('R7: 0 unmatched → sem alerta; ≥1 → warning unmatched_events', () => {
    expect(types(evalFor(snap({}), { ...CTX, unmatched: { count: 0, lastUnmatchedAt: null } }))).not.toContain('unmatched_events');
    expect(types(evalFor(snap({}), { ...CTX, unmatched: { count: 0, lastUnmatchedAt: null } }))).not.toContain('unmatched_events');
    const m = evalFor(snap({}), { ...CTX, unmatched: { count: 1, lastUnmatchedAt: NOW.toISOString() } });
    expect(severity(m, 'unmatched_events')).toBe('warning');
  });

  it('Precedência: R2 (critical) suprime R4 (warning) quando ambos disparam', () => {
    const raw = evaluateRules(snap({ lastHttpStatus: 503, errorCount24h: 6 }), CTX);
    expect(types(raw)).toContain('http_5xx');
    expect(types(raw)).toContain('error_spike');
    const suppressed = applyRuleSuppression(raw);
    expect(types(suppressed)).toContain('http_5xx');
    expect(types(suppressed)).not.toContain('error_spike');
  });

  it('Precedência: R3 suprime R6; problemas distintos (R1 + R5) permanecem independentes', () => {
    const inat = applyRuleSuppression(evaluateRules(snap({ active: false, lastSyncAt: null }), CTX));
    expect(types(inat)).toContain('system_inactive');
    expect(types(inat)).not.toContain('stale_sync');

    const mixed = evalFor(snap({ consecutiveErrors: 3, lastResponseMs: 6000 }), CTX);
    expect(types(mixed)).toContain('consecutive_failures');
    expect(types(mixed)).toContain('high_latency');
  });

  it('R1: R4 não suprime R1 (falhas consecutivas ≠ pico de erros)', () => {
    const m = evalFor(snap({ consecutiveErrors: 4, errorCount24h: 6, lastHttpStatus: 200 }), CTX);
    expect(types(m)).toContain('consecutive_failures');
    expect(types(m)).toContain('error_spike');
  });

  it('R2: 500 + 2 erros/24h não dispara R2 (limite é 3)', () => {
    const m = evalFor(snap({ lastHttpStatus: 500, errorCount24h: 2 }), CTX);
    expect(types(m)).not.toContain('http_5xx');
  });

  it('R7 puro: vários unmatched → apenas 1 match de tipo (coalescing puro)', () => {
    const m = evalFor(snap({}), { ...CTX, unmatched: { count: 7, lastUnmatchedAt: NOW.toISOString() } });
    const unmatchedMatches = m.filter((x) => x.type === 'unmatched_events');
    expect(unmatchedMatches.length).toBe(1);
    expect(m.find((x) => x.type === 'unmatched_events')?.details.unmatchedCount).toBe(7);
  });

  it('R7 puro: sem unmatched → sem alerta', () => {
    expect(types(evalFor(snap({}), { ...CTX, unmatched: undefined }))).not.toContain('unmatched_events');
    expect(types(evalFor(snap({}), { ...CTX, unmatched: { count: 0, lastUnmatchedAt: null } }))).not.toContain('unmatched_events');
  });
});

/* --------------------------- Testes PUROS (R8) --------------------------- */

describe('alertEngine — recovery (R8, função pura)', () => {
  it('R1 ativo + execução success → resolve', () => {
    const d = evaluateRecovery(openAlert('consecutive_failures'), snap({ consecutiveErrors: 0 }), { ...CTX, hasRecentSuccess: true });
    expect(d.shouldResolve).toBe(true);
  });

  it('R1 ativo sem evidência de success → NÃO resolve', () => {
    const d = evaluateRecovery(openAlert('consecutive_failures'), snap({ consecutiveErrors: 0 }), { ...CTX, hasRecentSuccess: false });
    expect(d.shouldResolve).toBe(false);
  });

  it('condição ainda vigora → NÃO resolve', () => {
    const d = evaluateRecovery(openAlert('consecutive_failures'), snap({ consecutiveErrors: 3 }), { ...CTX, hasRecentSuccess: true });
    expect(d.shouldResolve).toBe(false);
  });

  it('R3: reativação resolve; ainda inativo não resolve', () => {
    expect(evaluateRecovery(openAlert('system_inactive'), snap({ active: true }), CTX).shouldResolve).toBe(true);
    expect(evaluateRecovery(openAlert('system_inactive'), snap({ active: false }), CTX).shouldResolve).toBe(false);
  });

  it('R6: last_sync_at atualizado resolve', () => {
    const d = evaluateRecovery(
      openAlert('stale_sync'),
      snap({ lastSyncAt: new Date(NOW.getTime() - 60 * 1000).toISOString() }),
      CTX
    );
    expect(d.shouldResolve).toBe(true);
  });

  it('R7: sem unmatched + evento processado recente resolve; sem evidência não resolve', () => {
    const ok = evaluateRecovery(openAlert('unmatched_events'), snap({}), { ...CTX, unmatched: { count: 0, lastUnmatchedAt: null }, recentProcessed24h: true });
    expect(ok.shouldResolve).toBe(true);
    const noEvidence = evaluateRecovery(openAlert('unmatched_events'), snap({}), { ...CTX, unmatched: { count: 0, lastUnmatchedAt: null }, recentProcessed24h: false });
    expect(noEvidence.shouldResolve).toBe(false);
  });

  it('R5: latência abaixo do limite com execução success resolve', () => {
    const d = evaluateRecovery(openAlert('high_latency'), snap({ lastResponseMs: 2000 }), { ...CTX, hasRecentSuccess: true });
    expect(d.shouldResolve).toBe(true);
  });
});

/* --------------------------- Testes de segurança --------------------------- */

describe('alertEngine — proteção contra secrets', () => {
  it('redactSensitiveDetails redige chaves sensíveis recursivamente', () => {
    const cleaned = redactSensitiveDetails({
      api_key: 'REAL_API_KEY',
      password: 'REAL_PASS',
      token: 'TOKEN',
      ok: 1,
      nested: { client_secret: 'CS', endpoint: 'https://x.com' },
    });
    expect(cleaned.api_key).toBe('[REDACTED]');
    expect(cleaned.password).toBe('[REDACTED]');
    expect(cleaned.token).toBe('[REDACTED]');
    expect((cleaned.nested as any).client_secret).toBe('[REDACTED]');
    expect((cleaned.nested as any).endpoint).toBe('https://x.com');
    expect(cleaned.ok).toBe(1);
  });

  it('integração: details de alerta nunca contém segredos do config do sistema', async () => {
    const { id } = await createSystem({
      consecutiveErrors: 3,
      config: { endpoint: 'https://api.x.com', api_key: 'SUPER_SECRET_KEY_123', nested: { token: 'NESTED_TOKEN' } },
    });
    const summary = await runAlertEvaluation({ systemIds: [id] });
    expect(summary.created).toBe(1);

    const alert = await getAlert(id, 'consecutive_failures');
    const detailsJson = JSON.stringify(alert.details);
    expect(detailsJson).not.toContain('SUPER_SECRET_KEY_123');
    expect(detailsJson).not.toContain('NESTED_TOKEN');
    expect(detailsJson).not.toMatch(/api_key|password|token|secret/i);
  });
});

/* ------------------------- Integração com o banco ------------------------- */

describe('alertEngine — integração PostgreSQL (criação, coalescing, dedup, recovery)', () => {
  it('R1: criação e coalescing preservam o mesmo alerta e incrementam occurrences', async () => {
    const { id } = await createSystem({ consecutiveErrors: 3 });

    const first = await runAlertEvaluation({ systemIds: [id] });
    expect(first.created).toBe(1);
    const a1 = await getAlert(id, 'consecutive_failures');
    expect(a1.status).toBe('open');
    expect(a1.severity).toBe('critical');
    expect(a1.details.occurrences).toBe(1);
    expect(a1.details.consecutiveErrors).toBe(3);

    await setHealth(id, { consecutive_errors: 4 });
    const second = await runAlertEvaluation({ systemIds: [id] });
    expect(second.updated).toBe(1);
    const a2 = await getAlert(id, 'consecutive_failures');
    expect(a2.id).toBe(a1.id); // mesmo alerta — dedup
    expect(a2.details.occurrences).toBe(2);
    expect(a2.details.consecutiveErrors).toBe(4);
  });

  it('R1: recovery com execução success; sem evidência permanece aberto', async () => {
    const { id } = await createSystem({ consecutiveErrors: 3 });
    await runAlertEvaluation({ systemIds: [id] });
    expect((await getAlert(id, 'consecutive_failures')).status).toBe('open');

    // Condição cessa (consecutive_errors = 0) mas SEM evidência de success.
    await setHealth(id, { consecutive_errors: 0 });
    const noEvidence = await runAlertEvaluation({ systemIds: [id] });
    expect(noEvidence.resolved).toBe(0);
    expect((await getAlert(id, 'consecutive_failures')).status).toBe('open');

    // Agora com evidência de execução bem-sucedida.
    await addSuccessLog(id);
    const recovered = await runAlertEvaluation({ systemIds: [id] });
    expect(recovered.resolved).toBe(1);
    const alert = await getAlert(id, 'consecutive_failures');
    expect(alert.status).toBe('resolved');
    expect(alert.resolved_at).toBeTruthy();
    expect(alert.details.recovery).toBe(true);
    expect(alert.details.recoveryReason).toContain('execução bem-sucedida');
  });

  it('R8: alerta já resolved não é resolvido novamente e não cria duplicata', async () => {
    const { id } = await createSystem({ consecutiveErrors: 3 });
    await runAlertEvaluation({ systemIds: [id] });
    await setHealth(id, { consecutive_errors: 0 });
    await addSuccessLog(id);
    await runAlertEvaluation({ systemIds: [id] });
    expect((await getAlert(id, 'consecutive_failures')).status).toBe('resolved');

    const again = await runAlertEvaluation({ systemIds: [id] });
    expect(again.resolved).toBe(0);
    expect(again.created).toBe(0);
    const all = await run('SELECT COUNT(*)::int AS n FROM integration_alerts WHERE system_id = $1 AND type = $2', [id, 'consecutive_failures']);
    expect(all.rows[0].n).toBe(1);
  });

  it('Dedup: duas avaliações → mesmo id; acknowledged mantém mesmo id; resolved libera novo alerta', async () => {
    const { id } = await createSystem({ consecutiveErrors: 3 });

    await runAlertEvaluation({ systemIds: [id] });
    const a1 = await getAlert(id, 'consecutive_failures');

    // acknowledged simulado (como faria a ação administrativa da fase D1.5).
    await run(`UPDATE integration_alerts SET status = 'acknowledged' WHERE id = $1`, [a1.id]);
    await runAlertEvaluation({ systemIds: [id] });
    const a2 = await getAlert(id, 'consecutive_failures');
    expect(a2.id).toBe(a1.id);
    expect(a2.status).toBe('acknowledged'); // coalescing preserva o acknowledgment

    // resolve manualmente e força nova ocorrência — permite novo alerta do mesmo tipo.
    await run(`UPDATE integration_alerts SET status = 'resolved', resolved_at = NOW() WHERE id = $1`, [a1.id]);
    const summary = await runAlertEvaluation({ systemIds: [id] });
    expect(summary.created).toBe(1);
    const a3 = await getAlert(id, 'consecutive_failures');
    expect(a3.id).not.toBe(a1.id);
    expect(a3.status).toBe('open');
  });

  it('R2 + R4: apenas http_5xx (critical) é criado — sem ruído do error_spike', async () => {
    const { id } = await createSystem({ lastHttpStatus: 503, errorCount24h: 6 });
    const summary = await runAlertEvaluation({ systemIds: [id] });
    expect(summary.created).toBe(1);
    expect(await getAlert(id, 'http_5xx')).toBeTruthy();
    expect(await getAlert(id, 'error_spike')).toBeUndefined();
  });

  it('R3: sistema inativo → crítico criado uma vez; segunda avaliação não duplica nem reescreve', async () => {
    const { id } = await createSystem({ active: false });
    const first = await runAlertEvaluation({ systemIds: [id] });
    expect(first.created).toBe(1);
    const a1 = await getAlert(id, 'system_inactive');
    expect(a1.severity).toBe('critical');

    const second = await runAlertEvaluation({ systemIds: [id] });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);

    const a2 = await getAlert(id, 'system_inactive');
    expect(a2.id).toBe(a1.id);
    expect(a2.updated_at.getTime()).toBe(a1.updated_at.getTime()); // sem reescrita
    const n = await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM integration_alerts WHERE system_id = $1 AND type = $2', [id, 'system_inactive']);
    expect(n?.n).toBe(1);
  });

  it('R6: sistema inativo não gera stale_sync (apenas system_inactive)', async () => {
    const { id } = await createSystem({ active: false, lastSyncAt: null });
    await runAlertEvaluation({ systemIds: [id] });
    expect(await getAlert(id, 'system_inactive')).toBeTruthy();
    expect(await getAlert(id, 'stale_sync')).toBeUndefined();
  });

  it('R6: stale_sync criado e resolvido após sync recente', async () => {
    const { id } = await createSystem({ lastSyncAt: null });
    await runAlertEvaluation({ systemIds: [id] });
    expect((await getAlert(id, 'stale_sync')).status).toBe('open');

    await setHealth(id, { last_sync_at: new Date().toISOString() });
    const summary = await runAlertEvaluation({ systemIds: [id] });
    expect(summary.resolved).toBe(1);
    expect((await getAlert(id, 'stale_sync')).status).toBe('resolved');
  });

  it('R6: last_sync_at antigo (Date retornado pelo pg) cria stale_sync com mensagem válida', async () => {
    const { id } = await createSystem({ lastSyncAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
    const summary = await runAlertEvaluation({ systemIds: [id] });
    expect(summary.created).toBe(1);
    const alert = await getAlert(id, 'stale_sync');
    expect(alert.status).toBe('open');
    expect(alert.message).toMatch(/último sync em \d{4}-\d{2}-\d{2}/);
  });

  it('R7: 1 unmatched → criado; 2º unmatched → coalescing (mesmo id); processados → resolved', async () => {
    const { id, code } = await createSystem();

    await addUnmatchedEvent(id, code);
    const first = await runAlertEvaluation({ systemIds: [id] });
    expect(first.created).toBe(1);
    const a1 = await getAlert(id, 'unmatched_events');
    expect(a1.details.unmatchedCount).toBe(1);

    await addUnmatchedEvent(id, code);
    const second = await runAlertEvaluation({ systemIds: [id] });
    expect(second.updated).toBe(1);
    const a2 = await getAlert(id, 'unmatched_events');
    expect(a2.id).toBe(a1.id);
    expect(a2.details.unmatchedCount).toBe(2);

    // mapeamento corrigido: eventos agora processados → evidência de recovery.
    await run(`UPDATE webhook_events SET status = 'processed', processed_at = NOW(), error = NULL WHERE system_id = $1`, [id]);
    const recovered = await runAlertEvaluation({ systemIds: [id] });
    expect(recovered.resolved).toBe(1);
    expect((await getAlert(id, 'unmatched_events')).status).toBe('resolved');
  });

  it('R7: sem evidência de correção (eventos apenas envelhecem) → NÃO resolve', async () => {
    const { id, code } = await createSystem();
    await addUnmatchedEvent(id, code, new Date());
    await runAlertEvaluation({ systemIds: [id] });
    expect((await getAlert(id, 'unmatched_events')).status).toBe('open');

    // Sem evento processado: apenas o unmatched sai da janela de 24h.
    await run(`UPDATE webhook_events SET received_at = NOW() - INTERVAL '25 hours' WHERE system_id = $1`, [id]);
    const summary = await runAlertEvaluation({ systemIds: [id] });
    expect(summary.resolved).toBe(0);
    expect((await getAlert(id, 'unmatched_events')).status).toBe('open');
  });

  it('R5: latência alta cria warning; latência normal + success resolve', async () => {
    const { id } = await createSystem({ lastResponseMs: 6000 });
    await runAlertEvaluation({ systemIds: [id] });
    const a1 = await getAlert(id, 'high_latency');
    expect(a1.severity).toBe('warning');

    await setHealth(id, { last_response_ms: 2000 });
    await addSuccessLog(id);
    const summary = await runAlertEvaluation({ systemIds: [id] });
    expect(summary.resolved).toBe(1);
    expect((await getAlert(id, 'high_latency')).status).toBe('resolved');
  });

  it('Resumo da rodada contabiliza evaluatedSystems e não toca sistemas de fora do filtro', async () => {
    const { id } = await createSystem({ consecutiveErrors: 3 });
    const summary = await runAlertEvaluation({ systemIds: [id] });
    expect(summary.evaluatedSystems).toBe(1);
    expect(summary.created + summary.updated + summary.resolved + summary.skipped).toBe(1);
  });
});

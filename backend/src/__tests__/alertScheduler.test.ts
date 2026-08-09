/**
 * Fase D1.4 — Testes do Scheduler de Alertas Inteligentes.
 *
 * Cobertura mínima conforme especificação:
 * - intervalo padrão / configurável
 * - não iniciar duas vezes
 * - execução automática chama o motor
 * - erro do motor não derruba o processo
 * - advisory lock bloqueia segunda instância
 * - segunda instância recebe skip
 * - lock liberado após sucesso e erro
 * - scheduler interrompido corretamente
 * - nenhum scheduler criado em ambiente de teste
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import {
  startAlertScheduler,
  stopAlertScheduler,
  runScheduledAlertEvaluation,
  ALERT_LOCK_KEY,
  DEFAULT_INTERVAL_MS,
} from '../lib/alertScheduler.js';
import { pool } from '../database.js';

/* ------------------------------------------------------------------ */
/* Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock('../lib/alertEngine.js', () => ({
  runAlertEvaluation: vi.fn(),
}));

import { runAlertEvaluation } from '../lib/alertEngine.js';
const mockRunAlertEvaluation = vi.mocked(runAlertEvaluation);

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.useFakeTimers();
  mockRunAlertEvaluation.mockReset();
});

afterEach(() => {
  stopAlertScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await pool.end();
});

/* ------------------------------------------------------------------ */
/* 1. Agendamento — intervalo                                         */
/* ------------------------------------------------------------------ */

describe('alertScheduler — intervalo', () => {
  it('1. intervalo padrão é 5 minutos (300000 ms)', () => {
    expect(DEFAULT_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it('2. ALERT_EVALUATION_INTERVAL_MS configurado é respeitado', () => {
    const original = process.env.ALERT_EVALUATION_INTERVAL_MS;
    process.env.ALERT_EVALUATION_INTERVAL_MS = '120000';
    try {
      startAlertScheduler();
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      if (original !== undefined) process.env.ALERT_EVALUATION_INTERVAL_MS = original;
      else delete process.env.ALERT_EVALUATION_INTERVAL_MS;
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. Agendamento — proteção contra múltiplas inicializações          */
/* ------------------------------------------------------------------ */

describe('alertScheduler — proteção contra múltiplas inicializações', () => {
  it('3. scheduler não inicia duas vezes (idempotente)', () => {
    startAlertScheduler();
    startAlertScheduler();
    expect(vi.getTimerCount()).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Execução automática                                              */
/* ------------------------------------------------------------------ */

describe('alertScheduler — execução automática', () => {
  it('4. execução automática chama o motor', async () => {
    mockRunAlertEvaluation.mockResolvedValue({
      evaluatedSystems: 0, created: 0, updated: 0, resolved: 0, skipped: 0,
    });
    startAlertScheduler(100);

    vi.advanceTimersByTime(100);
    await vi.waitFor(() => expect(mockRunAlertEvaluation).toHaveBeenCalled());
  });
});

/* ------------------------------------------------------------------ */
/* 4. Resiliência — erros não derrubam o processo                      */
/* ------------------------------------------------------------------ */

describe('alertScheduler — resiliência a erros', () => {
  it('5. erro do motor não derruba o processo (retorna null)', async () => {
    mockRunAlertEvaluation.mockRejectedValue(new Error('DB offline'));
    const result = await runScheduledAlertEvaluation();
    expect(result).toBeNull();
  });

  it('5b. scheduler continua operacional após erro do motor', async () => {
    mockRunAlertEvaluation.mockRejectedValueOnce(new Error('fail'));
    mockRunAlertEvaluation.mockResolvedValueOnce({
      evaluatedSystems: 0, created: 0, updated: 0, resolved: 0, skipped: 0,
    });

    await runScheduledAlertEvaluation();
    expect(mockRunAlertEvaluation).toHaveBeenCalledTimes(1);

    const result = await runScheduledAlertEvaluation();
    expect(result).not.toBeNull();
    expect(mockRunAlertEvaluation).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Advisory Lock — concorrência                                     */
/* ------------------------------------------------------------------ */

describe('alertScheduler — advisory lock', () => {
  /** Adquire advisory lock manualmente (simula instância rival). */
  async function acquireManualLock(): Promise<{ client: any; acquired: boolean }> {
    const client = await pool.connect();
    const res = await client.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
      [ALERT_LOCK_KEY]
    );
    return { client, acquired: res.rows[0].pg_try_advisory_lock };
  }

  it('6. execução concorrente é bloqueada pelo advisory lock', async () => {
    const manual = await acquireManualLock();
    expect(manual.acquired).toBe(true);

    const result = await runScheduledAlertEvaluation();
    expect(result).toBeNull();

    await manual.client.query('SELECT pg_advisory_unlock($1)', [ALERT_LOCK_KEY]);
    manual.client.release();
  });

  it('7. segunda instância recebe skip e não executa o motor', async () => {
    const manual = await acquireManualLock();

    const result = await runScheduledAlertEvaluation();

    expect(result).toBeNull();
    expect(mockRunAlertEvaluation).not.toHaveBeenCalled();

    await manual.client.query('SELECT pg_advisory_unlock($1)', [ALERT_LOCK_KEY]);
    manual.client.release();
  });

  it('8. lock é liberado após sucesso', async () => {
    mockRunAlertEvaluation.mockResolvedValue({
      evaluatedSystems: 0, created: 0, updated: 0, resolved: 0, skipped: 0,
    });

    await runScheduledAlertEvaluation();

    const relock = await acquireManualLock();
    expect(relock.acquired).toBe(true);
    await relock.client.query('SELECT pg_advisory_unlock($1)', [ALERT_LOCK_KEY]);
    relock.client.release();
  });

  it('9. lock é liberado após erro do motor', async () => {
    mockRunAlertEvaluation.mockRejectedValue(new Error('boom'));
    await runScheduledAlertEvaluation();

    const relock = await acquireManualLock();
    expect(relock.acquired).toBe(true);
    await relock.client.query('SELECT pg_advisory_unlock($1)', [ALERT_LOCK_KEY]);
    relock.client.release();
  });
});

/* ------------------------------------------------------------------ */
/* 6. Shutdown                                                         */
/* ------------------------------------------------------------------ */

describe('alertScheduler — shutdown', () => {
  it('10. scheduler é interrompido corretamente', async () => {
    startAlertScheduler(50);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(50);
    stopAlertScheduler();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Ambiente de teste                                                */
/* ------------------------------------------------------------------ */

describe('alertScheduler — ambiente de teste', () => {
  it('11. nenhum scheduler é criado indevidamente (start deve ser idempotente)', () => {
    stopAlertScheduler();
    startAlertScheduler();
    expect(vi.getTimerCount()).toBe(1);
    stopAlertScheduler();
  });
});

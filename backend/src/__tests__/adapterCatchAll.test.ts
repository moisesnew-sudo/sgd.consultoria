/**
 * F2.1 — Hardening de produção: adapters governamentais nunca devem lançar
 * exceções para fora do sync(). Falhas inesperadas (rede, runtime) são
 * convertidas em SyncPullResult com httpStatus 0 e authError false,
 * permitindo tratamento uniforme e visibilidade no health status.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------ */
/* Mocks (vi.hoisted — antes de vi.mock)                               */
/* ------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  httpClient: vi.fn(),
  readSecret: vi.fn().mockReturnValue(null),
}));

vi.mock('../integrations/httpClient.js', () => ({
  httpClient: mocks.httpClient,
  readSecret: mocks.readSecret,
  requireEnv: vi.fn(),
  optionalEnv: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/* Imports (após mocks)                                                */
/* ------------------------------------------------------------------ */

import { transferegovGovAdapter } from '../integrations/transferegov.adapter.js';
import { seiGovAdapter } from '../integrations/sei.adapter.js';
import { cglogGovAdapter } from '../integrations/cglog.adapter.js';
import type { AdapterConfig } from '../integrations/types.js';

const config: AdapterConfig = {
  baseUrl: 'https://api.exemplo.gov.br',
  secretEnvKey: undefined,
};

const params: Record<string, unknown> = { proposalNumber: 'PROP-2026-001' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.httpClient.mockRejectedValue(new Error('network failure'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('F2.1 — Adapters: exceções inesperadas no sync()', () => {
  it('Transferegov: falha de rede retorna httpStatus 0 e authError false', async () => {
    const result = await transferegovGovAdapter.sync(config, params);

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.authError).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.fetchedCount).toBe(0);
    expect(result.normalizedCount).toBe(0);
  });

  it('SEI: falha de rede retorna httpStatus 0 e authError false', async () => {
    const result = await seiGovAdapter.sync(config, params);

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.authError).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('CGLOG: falha de rede retorna httpStatus 0 e authError false', async () => {
    const result = await cglogGovAdapter.sync(config, params);

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.authError).toBe(false);
    expect(result.error).toBeDefined();
  });
});

const REDACTED = '[REDACTED]';
const MASKED = '********';

/**
 * Converte recursivamente valores `[REDACTED]` (sentinelas da API) em `********`
 * para exibição, ocultando o segredo na interface.
 */
export function maskConfigForDisplay(config: unknown): unknown {
  if (!config || typeof config !== 'object') return config;
  if (Array.isArray(config)) return config.map(maskConfigForDisplay);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    out[k] = v === REDACTED ? MASKED : typeof v === 'object' && v !== null ? maskConfigForDisplay(v) : v;
  }
  return out;
}

/**
 * Converte recursivamente valores `********` de volta para o sentinela `[REDACTED]`
 * antes do submit, para que o backend mantenha o valor existente ("deixe vazio/*** para manter").
 */
export function unmaskConfigForSubmit(config: unknown): unknown {
  if (!config || typeof config !== 'object') return config;
  if (Array.isArray(config)) return config.map(unmaskConfigForSubmit);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    out[k] = v === MASKED ? REDACTED : typeof v === 'object' && v !== null ? unmaskConfigForSubmit(v) : v;
  }
  return out;
}

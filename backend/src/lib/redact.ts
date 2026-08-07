/**
 * Sanitização centralizada de configurações de integrações (Fase 3.1 — C4.1).
 *
 * Princípio do menor privilégio: campos sensíveis de `config` só devem ser
 * expostos a quem possui `integrations.manage`. Usuários com apenas
 * `integrations.view` recebem o valor redigido `[REDACTED]`.
 */

export const REDACTED_VALUE = '[REDACTED]';

/** Campos considerados sensíveis em `integration_systems.config`. */
export const SENSITIVE_CONFIG_KEY_RE =
  /(secret|token|password|passwd|api_key|private_key|authorization|credential)/i;

/**
 * Redige (ou não) valores sensíveis de um objeto de configuração.
 * - canViewSecrets = true  → retorna o objeto original (usuário com integrations.manage).
 * - canViewSecrets = false → valores de chaves sensíveis viram `[REDACTED]`, recursivamente.
 */
export function sanitizeIntegrationConfig(config: unknown, canViewSecrets = false): unknown {
  if (canViewSecrets) return config;
  if (!config || typeof config !== 'object') return config;
  if (Array.isArray(config)) return config.map((v) => sanitizeIntegrationConfig(v, false));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    if (typeof v === 'object' && v !== null) {
      out[k] = sanitizeIntegrationConfig(v, false);
    } else {
      out[k] = SENSITIVE_CONFIG_KEY_RE.test(k) ? REDACTED_VALUE : v;
    }
  }
  return out;
}

/**
 * Mescla a configuração enviada sobre a existente, sem nunca persistir o
 * sentinela `[REDACTED]` (ou `********`) nem campos vazios de segredos.
 *
 * Regras:
 * - chave = `[REDACTED]`/`********` → mantém o valor existente (ou remove se não existia);
 * - chave = null                     → remove a chave;
 * - demais chaves                    → substitui pelo novo valor.
 */
export function mergeIntegrationConfig(
  existing: unknown,
  submitted: unknown
): Record<string, unknown> | null {
  if (submitted === null) return null;
  if (submitted === undefined) {
    return existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : null;
  }

  const existingObj =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(submitted as Record<string, unknown>)) {
    if (v === REDACTED_VALUE || v === '********') {
      if (k in existingObj) out[k] = existingObj[k];
    } else if (v === null) {
      // omitido propositalmente (remover chave)
    } else {
      out[k] = v;
    }
  }
  return out;
}

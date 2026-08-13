/**
 * Fail-fast de configuração das integrações governamentais (Fase 2.1 — hardening).
 *
 * Centraliza a validação da configuração mínima de uma integração ANTES de qualquer
 * chamada HTTP externa (pull periódico, test-connection, sync manual).
 *
 * Princípios:
 * - Nunca revela segredos em mensagens de erro (sem valores de token/api_key/senha);
 * - Não inventa contratos: valida apenas o que a arquitetura já consome
 *   (config.baseUrl, config.secretEnvKey e config.extra.authType);
 * - Função pura e pequena, com responsabilidade única.
 */

export const CONFIGURATION_ERROR_CODE = 'CONFIGURATION_ERROR';

export interface IntegrationSystemLike {
  code: string;
  name?: string;
  active?: boolean;
  config?: Record<string, unknown> | null;
}

export interface IntegrationValidationResult {
  valid: boolean;
  code: 'OK' | 'CONFIGURATION_ERROR';
  /** Mensagens seguras (sem valores de segredos). */
  errors: string[];
}

/** Tipos de autenticação suportados por cada adapter governamental registrado. */
const SUPPORTED_AUTH_TYPES: Record<string, string[]> = {
  transferegov: ['api_key', 'oauth2'],
  sei: ['token', 'oauth2'],
  cglog: ['token', 'oauth2'],
};

function baseUrlFrom(system: IntegrationSystemLike): string | undefined {
  const baseUrl = system.config?.baseUrl;
  return typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : undefined;
}

function secretEnvKeyFrom(system: IntegrationSystemLike): string | undefined {
  const key = system.config?.secretEnvKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Verifica se a configuração de uma integração é operacionalmente utilizável.
 * Retorna `valid: false` (code CONFIGURATION_ERROR) quando qualquer requisito
 * obrigatório falha. As mensagens nunca contêm valores de segredos.
 */
export function validateIntegrationConfiguration(
  system: IntegrationSystemLike | null | undefined,
): IntegrationValidationResult {
  const errors: string[] = [];

  if (!system) {
    return { valid: false, code: 'CONFIGURATION_ERROR', errors: ['Sistema não encontrado'] };
  }

  if (system.active === false) {
    return { valid: false, code: 'CONFIGURATION_ERROR', errors: ['Sistema inativo'] };
  }

  const baseUrl = baseUrlFrom(system);
  if (!baseUrl) {
    errors.push('baseUrl ausente');
  } else if (!isValidBaseUrl(baseUrl)) {
    errors.push('baseUrl inválida');
  }

  const secretEnvKey = secretEnvKeyFrom(system);
  if (!secretEnvKey) {
    errors.push('credencial não configurada (secret_env_key ausente)');
  } else {
    const secret = process.env[secretEnvKey];
    if (!secret || secret.trim() === '') {
      errors.push('credencial não configurada (variável de ambiente ausente ou vazia)');
    }
  }

  const extra = (system.config?.extra ?? {}) as Record<string, unknown>;
  const authType = typeof extra.authType === 'string' ? extra.authType.trim() : undefined;
  const allowed = SUPPORTED_AUTH_TYPES[system.code?.toLowerCase() ?? ''];
  if (allowed && authType && !allowed.includes(authType)) {
    errors.push('configuração de autenticação inválida');
  }

  if (authType === 'oauth2') {
    const clientId = extra.clientId;
    if (typeof clientId !== 'string' || !clientId.trim()) {
      errors.push('configuração de autenticação inválida (clientId ausente para OAuth2)');
    }
  }

  if (errors.length > 0) {
    return { valid: false, code: 'CONFIGURATION_ERROR', errors };
  }
  return { valid: true, code: 'OK', errors: [] };
}

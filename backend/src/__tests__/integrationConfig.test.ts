import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CONFIGURATION_ERROR_CODE,
  PUBLIC_AUTH_TYPE,
  validateIntegrationConfiguration,
  type IntegrationSystemLike,
} from '../lib/integrationConfig.js';

function system(overrides: Partial<IntegrationSystemLike> = {}): IntegrationSystemLike {
  return { code: 'transferegov', active: true, ...overrides };
}

describe('validateIntegrationConfiguration (Fase 2.1 — fail-fast)', () => {
  beforeEach(() => {
    process.env.TRANSFEREGOV_API_KEY = 'secret-value-123456';
  });

  afterEach(() => {
    delete process.env.TRANSFEREGOV_API_KEY;
  });

  describe('Configuração', () => {
    it('configuração válida retorna valid=true', () => {
      const result = validateIntegrationConfiguration(system({
        config: { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'TRANSFEREGOV_API_KEY' },
      }));
      expect(result.valid).toBe(true);
      expect(result.code).toBe('OK');
      expect(result.errors).toEqual([]);
    });

    it('sistema null/undefined → CONFIGURATION_ERROR (Sistema não encontrado)', () => {
      expect(validateIntegrationConfiguration(null).valid).toBe(false);
      expect(validateIntegrationConfiguration(undefined).valid).toBe(false);
      expect(validateIntegrationConfiguration(null).errors).toContain('Sistema não encontrado');
    });

    it('sistema inativo → inválido', () => {
      const result = validateIntegrationConfiguration(system({ active: false }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Sistema inativo');
    });

    it('baseUrl ausente → inválido', () => {
      const result = validateIntegrationConfiguration(system({
        config: { secretEnvKey: 'TRANSFEREGOV_API_KEY' },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('baseUrl ausente');
    });

    it('baseUrl vazia → tratada como ausente', () => {
      const result = validateIntegrationConfiguration(system({
        config: { baseUrl: '   ', secretEnvKey: 'TRANSFEREGOV_API_KEY' },
      }));
      expect(result.errors).toContain('baseUrl ausente');
    });

    it('baseUrl inválida → inválido', () => {
      for (const bad of ['not-a-url', 'ftp://api.gov.br', 'http://', '://missing']) {
        const result = validateIntegrationConfiguration(system({
          config: { baseUrl: bad, secretEnvKey: 'TRANSFEREGOV_API_KEY' },
        }));
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('baseUrl inválida');
      }
    });

    it('secret_env_key ausente quando obrigatório → inválido', () => {
      const result = validateIntegrationConfiguration(system({
        config: { baseUrl: 'https://api.transferegov.gov.br' },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('credencial não configurada (secret_env_key ausente)');
    });

    it('secret_env_key presente mas variável de ambiente inexistente → inválido', () => {
      const result = validateIntegrationConfiguration(system({
        config: { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'KEY_QUE_NAO_EXISTE' },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('credencial não configurada (variável de ambiente ausente ou vazia)');
    });

    it('variável de ambiente existente porém vazia → inválido', () => {
      process.env.TRANSFEREGOV_API_KEY = '   ';
      const result = validateIntegrationConfiguration(system({
        config: { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'TRANSFEREGOV_API_KEY' },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('credencial não configurada (variável de ambiente ausente ou vazia)');
    });

    it('authType não suportado pelo adapter → inválido', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api.transferegov.gov.br',
          secretEnvKey: 'TRANSFEREGOV_API_KEY',
          extra: { authType: 'basic' },
        },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('configuração de autenticação inválida');
    });

    it('OAuth2 sem clientId → inválido', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api.transferegov.gov.br',
          secretEnvKey: 'TRANSFEREGOV_API_KEY',
          extra: { authType: 'oauth2' },
        },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('configuração de autenticação inválida (clientId ausente para OAuth2)');
    });

    it('OAuth2 com clientId válido → válido', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api.transferegov.gov.br',
          secretEnvKey: 'TRANSFEREGOV_API_KEY',
          extra: { authType: 'oauth2', clientId: 'sgd-client' },
        },
      }));
      expect(result.valid).toBe(true);
    });

    it('authType compatível com o adapter → válido (api_key/token)', () => {
      expect(validateIntegrationConfiguration(system({
        code: 'transferegov',
        config: { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'TRANSFEREGOV_API_KEY', extra: { authType: 'api_key' } },
      })).valid).toBe(true);
      process.env.SEI_API_TOKEN = 'sei-token-valido';
      try {
        expect(validateIntegrationConfiguration(system({
          code: 'sei',
          config: { baseUrl: 'https://api.sei.gov.br', secretEnvKey: 'SEI_API_TOKEN', extra: { authType: 'token' } },
        })).valid).toBe(true);
      } finally {
        delete process.env.SEI_API_TOKEN;
      }
    });

    it('config ausente (null/undefined) → inválido', () => {
      expect(validateIntegrationConfiguration(system({ config: null })).valid).toBe(false);
      expect(validateIntegrationConfiguration(system({ config: undefined })).valid).toBe(false);
    });
  });

  describe('Integrações públicas (A7.1 — authType=none)', () => {
    it('authType=none + HTTPS + sem secret → configuração válida', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api-publica.transferegov.gestao.gov.br/parcerias',
          extra: { authType: PUBLIC_AUTH_TYPE },
        },
      }));
      expect(result.valid).toBe(true);
      expect(result.code).toBe('OK');
      expect(result.errors).toEqual([]);
    });

    it('authType=none é genérico (não é exceção do Transferegov) → válido para qualquer sistema', () => {
      for (const code of ['transferegov', 'sei', 'cglog']) {
        const result = validateIntegrationConfiguration(system({
          code,
          config: {
            baseUrl: 'https://api-publica.gov.br',
            extra: { authType: PUBLIC_AUTH_TYPE },
          },
        }));
        expect(result.valid).toBe(true);
      }
    });

    it('authType=none + HTTP → inválida (integrações públicas exigem HTTPS)', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'http://api-publica.transferegov.gestao.gov.br/parcerias',
          extra: { authType: PUBLIC_AUTH_TYPE },
        },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('baseUrl inválida (integrações públicas exigem HTTPS)');
    });

    it('authType=none + baseUrl ausente → inválida (não aceita configuração incompleta)', () => {
      const result = validateIntegrationConfiguration(system({
        config: { extra: { authType: PUBLIC_AUTH_TYPE } },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('baseUrl ausente');
    });

    it('authType=none + sistema inativo → inválida', () => {
      const result = validateIntegrationConfiguration(system({
        active: false,
        config: {
          baseUrl: 'https://api-publica.gov.br',
          extra: { authType: PUBLIC_AUTH_TYPE },
        },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Sistema inativo');
    });

    it('authType=none não exige secretEnvKey nem variável de ambiente', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api-publica.transferegov.gestao.gov.br/parcerias',
          extra: { authType: PUBLIC_AUTH_TYPE },
        },
      }));
      expect(result.valid).toBe(true);
      expect(result.errors.join(' | ')).not.toContain('credencial');
    });

    it('authType=none não procura secret mesmo se secretEnvKey apontar para variável inexistente', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api-publica.gov.br',
          secretEnvKey: 'CHAVE_QUE_NAO_EXISTE',
          extra: { authType: PUBLIC_AUTH_TYPE },
        },
      }));
      expect(result.valid).toBe(true);
    });
  });

  describe('Autenticado (regressão — comportamento preservado)', () => {
    it('authType=api_key sem secretEnvKey → continua inválido', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api.transferegov.gov.br',
          extra: { authType: 'api_key' },
        },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('credencial não configurada (secret_env_key ausente)');
    });

    it('authType=oauth2 sem secretEnvKey → continua inválido (secret continua obrigatório)', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api.transferegov.gov.br',
          extra: { authType: 'oauth2', clientId: 'sgd-client' },
        },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('credencial não configurada (secret_env_key ausente)');
    });

    it('authType=bearer não suportado → continua inválido', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api.transferegov.gov.br',
          secretEnvKey: 'TRANSFEREGOV_API_KEY',
          extra: { authType: 'bearer' },
        },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('configuração de autenticação inválida');
    });

    it('authType=token com variável de ambiente ausente → continua inválido', () => {
      const result = validateIntegrationConfiguration(system({
        code: 'sei',
        config: {
          baseUrl: 'https://api.sei.gov.br',
          secretEnvKey: 'SEI_API_TOKEN_QUE_NAO_EXISTE',
          extra: { authType: 'token' },
        },
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('credencial não configurada (variável de ambiente ausente ou vazia)');
    });

    it('authType=none + secretEnvKey setado → secret não é lido, configuração permanece válida', () => {
      process.env.SECRET_DE_TESTE_QUE_EXISTE = 'valor-sensivel-que-nao-deve-ser-lido';
      try {
        const result = validateIntegrationConfiguration(system({
          config: {
            baseUrl: 'https://api-publica.gov.br',
            secretEnvKey: 'SECRET_DE_TESTE_QUE_EXISTE',
            extra: { authType: PUBLIC_AUTH_TYPE },
          },
        }));
        expect(result.valid).toBe(true);
        expect(JSON.stringify(result)).not.toContain('valor-sensivel-que-nao-deve-ser-lido');
      } finally {
        delete process.env.SECRET_DE_TESTE_QUE_EXISTE;
      }
    });
  });

  describe('Segurança', () => {
    it('erros nunca contêm o valor do segredo', () => {
      process.env.TRANSFEREGOV_API_KEY = 'SENHA-SUPER-SECRETA-987654321';
      const result = validateIntegrationConfiguration(system({
        config: { baseUrl: 'not-a-url', secretEnvKey: 'TRANSFEREGOV_API_KEY' },
      }));
      expect(result.valid).toBe(false);
      const text = result.errors.join(' | ');
      expect(text).not.toContain('SENHA-SUPER-SECRETA-987654321');
      expect(text).not.toContain('TRANSFEREGOV_API_KEY');
    });

    it('erros não contêm valores de tokens em outros campos do config', () => {
      const result = validateIntegrationConfiguration(system({
        config: {
          baseUrl: 'https://api.transferegov.gov.br',
          secretEnvKey: 'TRANSFEREGOV_API_KEY',
          extra: { authType: 'token', api_token: 'TOKEN-EXPOSTO-123' },
        },
      }));
      expect(result.errors.join(' | ')).not.toContain('TOKEN-EXPOSTO-123');
    });

    it('configuração válida não expõe segredo em nenhum campo de retorno', () => {
      const result = validateIntegrationConfiguration(system({
        config: { baseUrl: 'https://api.transferegov.gov.br', secretEnvKey: 'TRANSFEREGOV_API_KEY' },
      }));
      expect(JSON.stringify(result)).not.toContain('secret-value-123456');
    });
  });
});

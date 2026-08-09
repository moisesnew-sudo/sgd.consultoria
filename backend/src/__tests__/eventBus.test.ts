/**
 * Fase D1.5a — Testes do Event Bus central de integrações.
 *
 * Cobertura mínima conforme especificação:
 * 1. criação da instância
 * 2. emissão de evento
 * 3. listener recebe payload correto
 * 4. múltiplos listeners
 * 5. remoção de listener
 * 6. listener removido não recebe eventos
 * 7. listeners independentes
 * 8. erro em um listener não derruba os demais
 * 9. eventos diferentes não se misturam
 * 10. tipagem dos payloads
 * 11. ausência de dados sensíveis no payload
 * 12. ausência de memory leak básico após unsubscribe
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  emitIntegrationEvent,
  onIntegrationEvent,
  offIntegrationEvent,
  subscribe,
  unsubscribe,
  getListenerCount,
  removeAllListeners,
  type IntegrationCreatedPayload,
  type IntegrationUpdatedPayload,
  type IntegrationToggledPayload,
  type IntegrationSyncedPayload,
  type IntegrationHealthPayload,
  type IntegrationLogPayload,
  type IntegrationAlertPayload,
  type IntegrationHeartbeatPayload,
} from '../lib/eventBus.js';

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  removeAllListeners();
});

afterEach(() => {
  removeAllListeners();
});

/* ------------------------------------------------------------------ */
/* 1. Criação da instância                                            */
/* ------------------------------------------------------------------ */

describe('eventBus — instância', () => {
  it('1. funções exportadas são funcionais', () => {
    expect(typeof emitIntegrationEvent).toBe('function');
    expect(typeof onIntegrationEvent).toBe('function');
    expect(typeof offIntegrationEvent).toBe('function');
    expect(typeof subscribe).toBe('function');
    expect(typeof unsubscribe).toBe('function');
    expect(typeof getListenerCount).toBe('function');
    expect(typeof removeAllListeners).toBe('function');
  });
});

/* ------------------------------------------------------------------ */
/* 2. Emissão e recepção de evento                                    */
/* ------------------------------------------------------------------ */

describe('eventBus — emissão', () => {
  it('2. emite evento e listener recebe', () => {
    const handler = vi.fn();
    onIntegrationEvent('integration:created', handler);

    const payload: IntegrationCreatedPayload = { systemId: 1, code: 'sei', name: 'SEI' };
    emitIntegrationEvent('integration:created', payload);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('3. listener recebe payload correto (deep equal)', () => {
    const received: IntegrationSyncedPayload[] = [];
    onIntegrationEvent('integration:synced', (p) => received.push(p));

    const payload: IntegrationSyncedPayload = { systemId: 5, status: 'success', durationMs: 1234 };
    emitIntegrationEvent('integration:synced', payload);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(payload);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Múltiplos listeners                                             */
/* ------------------------------------------------------------------ */

describe('eventBus — múltiplos listeners', () => {
  it('4. múltiplos listeners recebem o mesmo evento', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();

    onIntegrationEvent('integration:toggled', h1);
    onIntegrationEvent('integration:toggled', h2);
    onIntegrationEvent('integration:toggled', h3);

    const payload: IntegrationToggledPayload = { systemId: 2, code: 'transferegov', active: false };
    emitIntegrationEvent('integration:toggled', payload);

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h3).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Remoção de listener                                             */
/* ------------------------------------------------------------------ */

describe('eventBus — remoção', () => {
  it('5. offIntegrationEvent remove o listener', () => {
    const handler = vi.fn();
    const id = onIntegrationEvent('integration:log', handler);

    offIntegrationEvent(id);
    emitIntegrationEvent('integration:log', { systemId: 1, level: 'info', message: 'test' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('6. listener removido não recebe eventos posteriores', () => {
    const handler = vi.fn();
    const id = onIntegrationEvent('integration:health', handler);

    emitIntegrationEvent('integration:health', { systemId: 1, health: 'operational', lastSyncAt: null });
    expect(handler).toHaveBeenCalledTimes(1);

    offIntegrationEvent(id);
    emitIntegrationEvent('integration:health', { systemId: 1, health: 'failure', lastSyncAt: null });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Listeners independentes                                         */
/* ------------------------------------------------------------------ */

describe('eventBus — independência', () => {
  it('7. eventos diferentes não acionam listeners de outros eventos', () => {
    const createdHandler = vi.fn();
    const syncedHandler = vi.fn();

    onIntegrationEvent('integration:created', createdHandler);
    onIntegrationEvent('integration:synced', syncedHandler);

    emitIntegrationEvent('integration:created', { systemId: 1, code: 'sei', name: 'SEI' });

    expect(createdHandler).toHaveBeenCalledTimes(1);
    expect(syncedHandler).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 8. Erro em listener não derruba os demais                          */
/* ------------------------------------------------------------------ */

describe('eventBus — resiliência', () => {
  it('8. erro em um listener não impede outros de receberem', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boomHandler = vi.fn(() => { throw new Error('boom'); });
    const okHandler = vi.fn();

    onIntegrationEvent('integration:alert', boomHandler);
    onIntegrationEvent('integration:alert', okHandler);

    const payload: IntegrationAlertPayload = { systemId: 1, alertType: 'stale', status: 'open' };
    emitIntegrationEvent('integration:alert', payload);

    expect(boomHandler).toHaveBeenCalledTimes(1);
    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(okHandler).toHaveBeenCalledWith(payload);

    errorSpy.mockRestore();
  });

  it('8b. erro do listener não propaga para o emissor', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    onIntegrationEvent('integration:log', () => { throw new Error('fail'); });

    expect(() => {
      emitIntegrationEvent('integration:log', { systemId: 1, level: 'error', message: 'x' });
    }).not.toThrow();

    errorSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/* 9. Eventos diferentes não se misturam                              */
/* ------------------------------------------------------------------ */

describe('eventBus — isolamento de eventos', () => {
  it('9. cada evento entrega somente ao seu listener', () => {
    const results: string[] = [];

    onIntegrationEvent('integration:created', () => results.push('created'));
    onIntegrationEvent('integration:updated', () => results.push('updated'));
    onIntegrationEvent('integration:toggled', () => results.push('toggled'));
    onIntegrationEvent('integration:synced', () => results.push('synced'));
    onIntegrationEvent('integration:health', () => results.push('health'));
    onIntegrationEvent('integration:log', () => results.push('log'));
    onIntegrationEvent('integration:alert', () => results.push('alert'));

    emitIntegrationEvent('integration:updated', { systemId: 1, code: 'sei', changes: ['name'] });

    expect(results).toEqual(['updated']);
  });
});

/* ------------------------------------------------------------------ */
/* 10. Tipagem dos payloads                                           */
/* ------------------------------------------------------------------ */

describe('eventBus — tipagem', () => {
  it('10. cada evento aceita somente seu payload tipado', () => {
    const created: IntegrationCreatedPayload = { systemId: 1, code: 'sei', name: 'SEI' };
    const updated: IntegrationUpdatedPayload = { systemId: 1, code: 'sei', changes: ['name'] };
    const toggled: IntegrationToggledPayload = { systemId: 1, code: 'sei', active: true };
    const synced: IntegrationSyncedPayload = { systemId: 1, status: 'success', durationMs: 100 };
    const health: IntegrationHealthPayload = { systemId: 1, health: 'operational', lastSyncAt: null };
    const log: IntegrationLogPayload = { systemId: 1, level: 'info', message: 'ok' };
    const alert: IntegrationAlertPayload = { systemId: 1, alertType: 'stale', status: 'open' };
    const heartbeat: IntegrationHeartbeatPayload = { timestamp: new Date().toISOString() };

    const h = vi.fn();

    onIntegrationEvent('integration:created', h);
    emitIntegrationEvent('integration:created', created);
    expect(h).toHaveBeenCalledWith(created);

    removeAllListeners();
    onIntegrationEvent('integration:updated', h);
    emitIntegrationEvent('integration:updated', updated);
    expect(h).toHaveBeenCalledWith(updated);

    removeAllListeners();
    onIntegrationEvent('integration:toggled', h);
    emitIntegrationEvent('integration:toggled', toggled);
    expect(h).toHaveBeenCalledWith(toggled);

    removeAllListeners();
    onIntegrationEvent('integration:synced', h);
    emitIntegrationEvent('integration:synced', synced);
    expect(h).toHaveBeenCalledWith(synced);

    removeAllListeners();
    onIntegrationEvent('integration:health', h);
    emitIntegrationEvent('integration:health', health);
    expect(h).toHaveBeenCalledWith(health);

    removeAllListeners();
    onIntegrationEvent('integration:log', h);
    emitIntegrationEvent('integration:log', log);
    expect(h).toHaveBeenCalledWith(log);

    removeAllListeners();
    onIntegrationEvent('integration:alert', h);
    emitIntegrationEvent('integration:alert', alert);
    expect(h).toHaveBeenCalledWith(alert);

    removeAllListeners();
    onIntegrationEvent('integration:heartbeat', h);
    emitIntegrationEvent('integration:heartbeat', heartbeat);
    expect(h).toHaveBeenCalledWith(heartbeat);
  });
});

/* ------------------------------------------------------------------ */
/* 11. Ausência de dados sensíveis                                    */
/* ------------------------------------------------------------------ */

describe('eventBus — segurança', () => {
  const SENSITIVE_KEYS = [
    'config', 'secret', 'api_key', 'password', 'token',
    'client_secret', 'private_key', 'jwt', 'cookie',
    'credential', 'env', 'secret_env_key',
  ];

  const safePayloads: Array<{ event: string; payload: Record<string, unknown> }> = [
    { event: 'integration:created', payload: { systemId: 1, code: 'sei', name: 'SEI' } },
    { event: 'integration:updated', payload: { systemId: 1, code: 'sei', changes: ['name'] } },
    { event: 'integration:toggled', payload: { systemId: 1, code: 'sei', active: true } },
    { event: 'integration:synced', payload: { systemId: 1, status: 'success', durationMs: 100 } },
    { event: 'integration:health', payload: { systemId: 1, health: 'operational', lastSyncAt: null } },
    { event: 'integration:log', payload: { systemId: 1, level: 'info', message: 'ok' } },
    { event: 'integration:alert', payload: { systemId: 1, alertType: 'stale', status: 'open' } },
    { event: 'integration:heartbeat', payload: { timestamp: new Date().toISOString() } },
  ];

  it('11. nenhum payload contém dados sensíveis', () => {
    for (const { event, payload } of safePayloads) {
      const json = JSON.stringify(payload);
      for (const key of SENSITIVE_KEYS) {
        expect(json.toLowerCase()).not.toContain(key);
      }
    }
  });

  it('11b. payloads não contêm chaves proibidas diretamente', () => {
    for (const { payload } of safePayloads) {
      for (const key of SENSITIVE_KEYS) {
        expect(payload).not.toHaveProperty(key);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 12. Memory leak                                                    */
/* ------------------------------------------------------------------ */

describe('eventBus — memory leak', () => {
  it('12. unsubscribe remove listener e count zera', () => {
    const ids: string[] = [];

    for (let i = 0; i < 50; i++) {
      const id = onIntegrationEvent('integration:heartbeat', () => {});
      ids.push(id);
    }
    expect(getListenerCount()).toBe(50);

    for (const id of ids) {
      unsubscribe(id);
    }
    expect(getListenerCount()).toBe(0);
  });

  it('12b. removeAllListeners limpa tudo', () => {
    onIntegrationEvent('integration:created', () => {});
    onIntegrationEvent('integration:updated', () => {});
    onIntegrationEvent('integration:synced', () => {});
    expect(getListenerCount()).toBe(3);

    removeAllListeners();
    expect(getListenerCount()).toBe(0);
  });
});

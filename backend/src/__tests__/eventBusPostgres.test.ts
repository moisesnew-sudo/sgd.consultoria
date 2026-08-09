/**
 * Fase D1.7 — Testes do PostgreSQL LISTEN/NOTIFY para SSE multi-instância.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ------------------------------------------------------------------ */
/* Mocks (vi.hoisted — antes de vi.mock)                               */
/* ------------------------------------------------------------------ */

const mocks = vi.hoisted(() => {
  const mockRelease = vi.fn();
  const mockRemoveAllListeners = vi.fn();
  const mockClientOn = vi.fn();
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  const mockPoolEnd = vi.fn().mockResolvedValue(undefined);

  const mockClient = {
    query: mockQuery,
    release: mockRelease,
    on: mockClientOn,
    removeAllListeners: mockRemoveAllListeners,
  };

  const mockPoolConnect = vi.fn().mockResolvedValue(mockClient);

  class MockPool {
    connect = mockPoolConnect;
    end = mockPoolEnd;
  }

  return { mockRelease, mockRemoveAllListeners, mockClientOn, mockQuery, mockPoolEnd, mockClient, mockPoolConnect, MockPool };
});

vi.mock('pg', () => ({
  default: { Pool: mocks.MockPool },
}));

/* ------------------------------------------------------------------ */
/* Imports (após mocks)                                                */
/* ------------------------------------------------------------------ */

import {
  publishEvent,
  onIntegrationEvent,
  getEventNames,
  registerPostgresNotify,
  removeAllListeners,
} from '../lib/eventBus.js';
import {
  getOriginId,
  setOriginId,
  notifyPostgres,
  startPostgresListener,
  stopPostgresListener,
  getBufferedEvents,
  getPendingNotificationCount,
  getLostEventCount,
  getLastReconnectReason,
} from '../lib/eventBusPostgres.js';
import { getListenerStatus } from '../lib/healthStatus.js';

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  removeAllListeners();
  vi.clearAllMocks();
  setOriginId('');
});

afterEach(() => {
  removeAllListeners();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* 1. publishEvent emite localmente                                    */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — publishEvent local', () => {
  it('1. publishEvent emite evento no eventBus local', async () => {
    const handler = vi.fn();
    onIntegrationEvent('demand:created', handler);

    await publishEvent('demand:created', {
      demandId: 'SGD-2026-ABC12345',
      title: 'Demanda Teste',
      status: 'pendente',
      municipality: 'São Paulo',
      uf: 'SP',
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* 2. publishEvent chama notifyPostgres                               */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — publishEvent notify', () => {
  it('2. publishEvent chama notifyFn quando registrado', async () => {
    const notifyFn = vi.fn().mockResolvedValue(undefined);
    registerPostgresNotify(notifyFn);

    await publishEvent('demand:created', {
      demandId: 'SGD-2026-XYZ99999',
      title: 'Teste',
      status: 'pendente',
      municipality: 'Rio',
      uf: 'RJ',
    });

    expect(notifyFn).toHaveBeenCalledTimes(1);
    expect(notifyFn).toHaveBeenCalledWith('demand:created', {
      demandId: 'SGD-2026-XYZ99999',
      title: 'Teste',
      status: 'pendente',
      municipality: 'Rio',
      uf: 'RJ',
    });
  });
});

/* ------------------------------------------------------------------ */
/* 3. notifyPostgres envia JSON correto                               */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — notifyPostgres', () => {
  it('3. notifyPostgres envia payload JSON via pg_notify', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-test-001');
    await startPostgresListener();

    await notifyPostgres('demand:created', { demandId: 'SGD-2026-TEST0001' });

    expect(mocks.mockPoolConnect).toHaveBeenCalled();
    expect(mocks.mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('pg_notify'),
      expect.arrayContaining(['sgd_events']),
    );
  });
});

/* ------------------------------------------------------------------ */
/* 4. Anti-duplicação: mesmo originId ignorado                         */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — anti-duplicação', () => {
  it('4. eventos do mesmo originId são ignorados', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();

    const handler = vi.fn();
    onIntegrationEvent('demand:created', handler);

    const notificationHandler = mocks.mockClientOn.mock.calls.find(
      (c: any[]) => c[0] === 'notification'
    )?.[1];

    if (notificationHandler) {
      notificationHandler({
        payload: JSON.stringify({
          event: 'demand:created',
          payload: { demandId: 'SGD-2026-TEST' },
          originId: 'inst-001',
          timestamp: new Date().toISOString(),
        }),
      });
    }

    expect(handler).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 5. Anti-duplicação: outro originId reemitido                        */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — reemissão remota', () => {
  it('5. eventos de outro originId são reemitidos localmente', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();

    const handler = vi.fn();
    onIntegrationEvent('demand:created', handler);

    const notificationHandler = mocks.mockClientOn.mock.calls.find(
      (c: any[]) => c[0] === 'notification'
    )?.[1];

    expect(notificationHandler).toBeDefined();

    if (notificationHandler) {
      notificationHandler({
        payload: JSON.stringify({
          event: 'demand:created',
          payload: { demandId: 'SGD-2026-REMOTE01' },
          originId: 'inst-002',
          timestamp: new Date().toISOString(),
        }),
      });
    }

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ demandId: 'SGD-2026-REMOTE01' });
  });
});

/* ------------------------------------------------------------------ */
/* 6. handleNotification ignora JSON inválido                          */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — JSON inválido', () => {
  it('6. ignora notificação com JSON inválido', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();

    const handler = vi.fn();
    onIntegrationEvent('demand:created', handler);

    const notificationHandler = mocks.mockClientOn.mock.calls.find(
      (c: any[]) => c[0] === 'notification'
    )?.[1];

    if (notificationHandler) {
      notificationHandler({ payload: 'not-valid-json' });
    }

    expect(handler).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 7. handleNotification ignora eventos desconhecidos                  */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — eventos desconhecidos', () => {
  it('7. ignora eventos que não estão na lista suportada', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();

    const handler = vi.fn();
    onIntegrationEvent('demand:created', handler);

    const notificationHandler = mocks.mockClientOn.mock.calls.find(
      (c: any[]) => c[0] === 'notification'
    )?.[1];

    if (notificationHandler) {
      notificationHandler({
        payload: JSON.stringify({
          event: 'unknown:event',
          payload: {},
          originId: 'inst-002',
          timestamp: new Date().toISOString(),
        }),
      });
    }

    expect(handler).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 8. handleNotification ignora payloads grandes                       */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — payload grande', () => {
  it('8. ignora payload maior que 64KB', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();

    const handler = vi.fn();
    onIntegrationEvent('demand:created', handler);

    const notificationHandler = mocks.mockClientOn.mock.calls.find(
      (c: any[]) => c[0] === 'notification'
    )?.[1];

    if (notificationHandler) {
      const bigPayload = 'x'.repeat(65 * 1024);
      notificationHandler({ payload: bigPayload });
    }

    expect(handler).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 9. startPostgresListener sem DATABASE_URL                           */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — start sem DATABASE_URL', () => {
  it('9. faz skip quando DATABASE_URL não está definida', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    await startPostgresListener();
    expect(mocks.mockPoolConnect).not.toHaveBeenCalled();

    if (original) process.env.DATABASE_URL = original;
  });
});

/* ------------------------------------------------------------------ */
/* 10. stopPostgresListener limpa recursos                             */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — stop', () => {
  it('10. stopPostgresListener libera conexão e pool', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();
    await stopPostgresListener();

    expect(mocks.mockRemoveAllListeners).toHaveBeenCalled();
    expect(mocks.mockRelease).toHaveBeenCalled();
    expect(mocks.mockPoolEnd).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 11. getEventNames                                                   */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — getEventNames', () => {
  it('11. retorna lista de eventos válidos', () => {
    const names = getEventNames();
    expect(names).toContain('demand:created');
    expect(names).toContain('demand:updated');
    expect(names).toContain('demand:status_changed');
    expect(names).toContain('demand:deleted');
    expect(names).toContain('comment:created');
    expect(names).toContain('integration:created');
    expect(names).toContain('integration:heartbeat');
    expect(names).toHaveLength(13);
  });
});

/* ------------------------------------------------------------------ */
/* 12. registerPostgresNotify                                          */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — registerPostgresNotify', () => {
  it('12. registra função e publishEvent a chama', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    registerPostgresNotify(fn);

    await publishEvent('integration:heartbeat', {
      timestamp: new Date().toISOString(),
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('integration:heartbeat', expect.any(Object));
  });
});

/* ------------------------------------------------------------------ */
/* 13. Reconexão após erro                                             */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — reconexão', () => {
  it('13. erro na conexão não impede futuras tentativas', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';

    mocks.mockPoolConnect
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(mocks.mockClient);

    setOriginId('inst-001');
    await startPostgresListener();

    await new Promise(r => setTimeout(r, 150));

    expect(mocks.mockPoolConnect).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/* 14. setOriginId/getOriginId                                         */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — originId', () => {
  it('14. setOriginId e getOriginId funcionam corretamente', () => {
    expect(getOriginId()).toBe('');
    setOriginId('my-custom-id');
    expect(getOriginId()).toBe('my-custom-id');
  });
});

/* ------------------------------------------------------------------ */
/* 15-17. F2.1 — Recuperação de eventos                                */
/* ------------------------------------------------------------------ */

describe('eventBusPostgres — F2.1 buffer de eventos', () => {
  it('15. notifyPostgres armazena eventos no buffer temporário', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();

    await notifyPostgres('demand:created', { demandId: 'SGD-BUF-1' });
    await notifyPostgres('demand:updated', { demandId: 'SGD-BUF-2' });

    const buffered = getBufferedEvents();
    const lastTwo = buffered.slice(-2);
    expect(lastTwo.length).toBe(2);
    expect(lastTwo[0].event).toBe('demand:created');
    expect(lastTwo[1].event).toBe('demand:updated');
    expect(lastTwo[0].seq).toBeLessThan(lastTwo[1].seq);

    await stopPostgresListener();
  });

  it('16. falha no notify incrementa eventos perdidos e enfileira pendente', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();

    mocks.mockPoolConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await notifyPostgres('demand:created', { demandId: 'SGD-LOST-1' });

    expect(getLostEventCount()).toBeGreaterThanOrEqual(1);
    expect(getPendingNotificationCount()).toBeGreaterThanOrEqual(1);

    await stopPostgresListener();
  });
});

describe('eventBusPostgres — F2.1 motivo de reconexão', () => {
  it('17. erro de conexão registra motivo na health status', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
    setOriginId('inst-001');
    await startPostgresListener();

    const errorHandler = mocks.mockClientOn.mock.calls.find(
      (c: any[]) => c[0] === 'error'
    )?.[1];

    expect(errorHandler).toBeDefined();
    if (errorHandler) errorHandler(new Error('connection reset'));

    const status = getListenerStatus();
    expect(status.lastReconnectReason).toBe('connection_error');
    expect(getLastReconnectReason()).toBe('connection_error');

    await stopPostgresListener();
  });
});

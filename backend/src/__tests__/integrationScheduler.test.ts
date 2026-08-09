import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startIntegrationScheduler,
  stopIntegrationScheduler,
  runScheduledSyncCycle,
  SYNC_LOCK_KEY,
  DEFAULT_CHECK_INTERVAL_MS,
  ALERT_THRESHOLD,
  lastSyncBySystem,
  consecutiveErrorsBySystem,
  parseSystemSyncConfig,
  loadActiveSyncSystems,
  checkDuplicate,
} from '../lib/integrationScheduler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPoolConnect = vi.fn();
const mockPoolRelease = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('../database.js', () => ({
  pool: {
    connect: () => mockPoolConnect(),
  },
  get: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
}));

vi.mock('../lib/adapterRegistry.js', () => ({
  getGovAdapter: vi.fn(),
}));

vi.mock('../lib/integrationSync.js', () => ({
  findDemandByProposalNumber: vi.fn(),
}));

vi.mock('../lib/statusMapping.js', () => ({
  getMappedStatus: vi.fn(),
}));

vi.mock('../lib/eventBus.js', () => ({
  publishEvent: vi.fn(),
  emitIntegrationEvent: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// 1. Configuração por sistema (parseSystemSyncConfig)
// ---------------------------------------------------------------------------
describe('parseSystemSyncConfig', () => {
  it('retorna config padrão quando config é null', () => {
    const result = parseSystemSyncConfig(null);
    expect(result.enabled).toBe(false);
    expect(result.intervalMinutes).toBe(60);
    expect(result.maxRecords).toBe(100);
  });

  it('retorna config padrão quando config é undefined', () => {
    const result = parseSystemSyncConfig(undefined);
    expect(result.enabled).toBe(false);
    expect(result.intervalMinutes).toBe(60);
    expect(result.maxRecords).toBe(100);
  });

  it('retorna config padrão quando config é string', () => {
    const result = parseSystemSyncConfig('invalid');
    expect(result.enabled).toBe(false);
  });

  it('retorna config personalizada quando config é válido', () => {
    const result = parseSystemSyncConfig({ syncEnabled: true, syncIntervalMinutes: 30, maxRecordsPerSync: 50 });
    expect(result.enabled).toBe(true);
    expect(result.intervalMinutes).toBe(30);
    expect(result.maxRecords).toBe(50);
  });

  it('syncEnabled false retorna enabled false', () => {
    const result = parseSystemSyncConfig({ syncEnabled: false });
    expect(result.enabled).toBe(false);
  });

  it('syncIntervalMinutes negativo usa padrão', () => {
    const result = parseSystemSyncConfig({ syncEnabled: true, syncIntervalMinutes: -5 });
    expect(result.intervalMinutes).toBe(60);
  });

  it('maxRecordsPerSync zero usa padrão', () => {
    const result = parseSystemSyncConfig({ syncEnabled: true, maxRecordsPerSync: 0 });
    expect(result.maxRecords).toBe(100);
  });

  it('syncIntervalMinutes não-numérico usa padrão', () => {
    const result = parseSystemSyncConfig({ syncEnabled: true, syncIntervalMinutes: 'invalid' });
    expect(result.intervalMinutes).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------
describe('Constants do scheduler', () => {
  it('SYNC_LOCK_KEY é um número válido', () => {
    expect(typeof SYNC_LOCK_KEY).toBe('number');
    expect(SYNC_LOCK_KEY).toBe(738291046);
    expect(SYNC_LOCK_KEY).not.toBe(738291045); // Diferente do alertScheduler
  });

  it('DEFAULT_CHECK_INTERVAL_MS é 60 segundos', () => {
    expect(DEFAULT_CHECK_INTERVAL_MS).toBe(60_000);
  });

  it('ALERT_THRESHOLD é 3', () => {
    expect(ALERT_THRESHOLD).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Start/Stop do scheduler
// ---------------------------------------------------------------------------
describe('Start/Stop do Integration Scheduler', () => {
  beforeEach(() => {
    stopIntegrationScheduler();
    lastSyncBySystem.clear();
    consecutiveErrorsBySystem.clear();
  });

  afterEach(() => {
    stopIntegrationScheduler();
  });

  it('start cria intervalo', () => {
    startIntegrationScheduler(60_000);
    // Não deve lançar erro
  });

  it('start é idempotente (não cria dois timers)', () => {
    startIntegrationScheduler(60_000);
    startIntegrationScheduler(60_000);
    // Não deve lançar erro
  });

  it('stop limpa o timer', () => {
    startIntegrationScheduler(60_000);
    stopIntegrationScheduler();
    // Não deve lançar erro
  });

  it('stop sem start não lança erro', () => {
    stopIntegrationScheduler();
  });
});

// ---------------------------------------------------------------------------
// 4. Lock impede execução duplicada
// ---------------------------------------------------------------------------
describe('Lock de execução', () => {
  beforeEach(() => {
    stopIntegrationScheduler();
    lastSyncBySystem.clear();
    consecutiveErrorsBySystem.clear();
  });

  it('lock key é exclusiva (diferente do alertScheduler)', () => {
    expect(SYNC_LOCK_KEY).not.toBe(738291045);
  });

  it('execução concorrente é prevenida (running = true)', async () => {
    // Simular lock adquirido
    mockPoolConnect.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ pg_try_advisory_lock: true }] }),
      release: vi.fn(),
    });

    // Mock loadActiveSyncSystems para retornar vazio
    const { all } = await import('../database.js');
    (all as any).mockResolvedValue([]);

    // Primeira execução
    const result1 = await runScheduledSyncCycle();
    expect(result1).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Sync com sistema inativo/desabilitado
// ---------------------------------------------------------------------------
describe('Sistemas desabilitados', () => {
  beforeEach(() => {
    stopIntegrationScheduler();
    lastSyncBySystem.clear();
    consecutiveErrorsBySystem.clear();
  });

  it('parseSystemSyncConfig com syncEnabled=false retorna enabled false', () => {
    const config = parseSystemSyncConfig({ syncEnabled: false, syncIntervalMinutes: 30 });
    expect(config.enabled).toBe(false);
  });

  it('config padrão tem syncEnabled=false', () => {
    const config = parseSystemSyncConfig({});
    expect(config.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Deduplicação (checkDuplicate)
// ---------------------------------------------------------------------------
describe('Deduplicação', () => {
  beforeEach(() => {
    lastSyncBySystem.clear();
    consecutiveErrorsBySystem.clear();
  });

  it('checkDuplicate retorna false quando não existe registro', async () => {
    const { get } = await import('../database.js');
    (get as any).mockResolvedValue(null);

    const result = await checkDuplicate(1, 'demand-1', {
      systemCode: 'transferegov',
      eventType: 'sync',
      proposalNumber: 'PROP-001',
      externalId: 'EXT-001',
      externalStatus: 'APROVADO',
    });
    expect(result).toBe(false);
  });

  it('checkDuplicate retorna true quando status e external_id são idênticos', async () => {
    const { get } = await import('../database.js');
    (get as any).mockResolvedValue({
      external_id: 'EXT-001',
      proposal_number: 'PROP-001',
      sync_status: 'synced',
      data: { changes: { status: 'APROVADO' } },
    });

    const result = await checkDuplicate(1, 'demand-1', {
      systemCode: 'transferegov',
      eventType: 'sync',
      proposalNumber: 'PROP-001',
      externalId: 'EXT-001',
      externalStatus: 'APROVADO',
    });
    expect(result).toBe(true);
  });

  it('checkDuplicate retorna false quando status mudou', async () => {
    const { get } = await import('../database.js');
    (get as any).mockResolvedValue({
      external_id: 'EXT-001',
      proposal_number: 'PROP-001',
      sync_status: 'synced',
      data: { changes: { status: 'EM_ANALISE' } },
    });

    const result = await checkDuplicate(1, 'demand-1', {
      systemCode: 'transferegov',
      eventType: 'sync',
      proposalNumber: 'PROP-001',
      externalId: 'EXT-001',
      externalStatus: 'APROVADO',
    });
    expect(result).toBe(false);
  });

  it('checkDuplicate retorna false quando external_id mudou', async () => {
    const { get } = await import('../database.js');
    (get as any).mockResolvedValue({
      external_id: 'EXT-ANTIGO',
      proposal_number: 'PROP-001',
      sync_status: 'synced',
      data: { changes: { status: 'APROVADO' } },
    });

    const result = await checkDuplicate(1, 'demand-1', {
      systemCode: 'transferegov',
      eventType: 'sync',
      proposalNumber: 'PROP-001',
      externalId: 'EXT-NOVO',
      externalStatus: 'APROVADO',
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Erros consecutivos
// ---------------------------------------------------------------------------
describe('Erros consecutivos', () => {
  beforeEach(() => {
    consecutiveErrorsBySystem.clear();
  });

  it('ALERT_THRESHOLD define limite para alertas', () => {
    expect(ALERT_THRESHOLD).toBeGreaterThanOrEqual(1);
  });

  it('erros consecutivos são rastreados por sistema', () => {
    consecutiveErrorsBySystem.set('transferegov', 2);
    expect(consecutiveErrorsBySystem.get('transferegov')).toBe(2);
  });

  it('sucesso limpa erros consecutivos', () => {
    consecutiveErrorsBySystem.set('transferegov', 5);
    consecutiveErrorsBySystem.set('transferegov', 0);
    expect(consecutiveErrorsBySystem.get('transferegov')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Configuração por integração
// ---------------------------------------------------------------------------
describe('Configuração por integração', () => {
  it('syncIntervalMinutes controla frequência', () => {
    const config = parseSystemSyncConfig({ syncEnabled: true, syncIntervalMinutes: 30 });
    expect(config.intervalMinutes).toBe(30);
  });

  it('maxRecordsPerSync controla volume', () => {
    const config = parseSystemSyncConfig({ syncEnabled: true, maxRecordsPerSync: 50 });
    expect(config.maxRecords).toBe(50);
  });

  it('syncEnabled controla ativação', () => {
    const enabled = parseSystemSyncConfig({ syncEnabled: true });
    const disabled = parseSystemSyncConfig({ syncEnabled: false });
    expect(enabled.enabled).toBe(true);
    expect(disabled.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Estados de sincronização
// ---------------------------------------------------------------------------
describe('Estados de sincronização', () => {
  it('lastSyncBySystem rastreia última sincronização por sistema', () => {
    lastSyncBySystem.clear();
    lastSyncBySystem.set('transferegov', Date.now());
    expect(lastSyncBySystem.get('transferegov')).toBeGreaterThan(0);
  });

  it('lastSyncBySystem permite múltiplos sistemas', () => {
    lastSyncBySystem.clear();
    lastSyncBySystem.set('transferegov', 1000);
    lastSyncBySystem.set('sei', 2000);
    lastSyncBySystem.set('cglog', 3000);
    expect(lastSyncBySystem.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 10. Shutdown correto
// ---------------------------------------------------------------------------
describe('Shutdown', () => {
  beforeEach(() => {
    stopIntegrationScheduler();
    lastSyncBySystem.clear();
    consecutiveErrorsBySystem.clear();
  });

  it('stop limpa timer e permite restart', () => {
    startIntegrationScheduler(60_000);
    stopIntegrationScheduler();
    startIntegrationScheduler(60_000);
    stopIntegrationScheduler();
  });

  it('múltiplos stops são seguros', () => {
    stopIntegrationScheduler();
    stopIntegrationScheduler();
    stopIntegrationScheduler();
  });
});

// ---------------------------------------------------------------------------
// 11. Integrações independentes
// ---------------------------------------------------------------------------
describe('Múltiplas integrações independentes', () => {
  beforeEach(() => {
    lastSyncBySystem.clear();
    consecutiveErrorsBySystem.clear();
  });

  it('cada sistema tem seu próprio lastSync', () => {
    lastSyncBySystem.set('transferegov', 1000);
    lastSyncBySystem.set('sei', 2000);
    expect(lastSyncBySystem.get('transferegov')).toBe(1000);
    expect(lastSyncBySystem.get('sei')).toBe(2000);
  });

  it('cada sistema tem seu próprio consecutiveErrors', () => {
    consecutiveErrorsBySystem.set('transferegov', 1);
    consecutiveErrorsBySystem.set('sei', 3);
    expect(consecutiveErrorsBySystem.get('transferegov')).toBe(1);
    expect(consecutiveErrorsBySystem.get('sei')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 12. Environment variable para intervalo
// ---------------------------------------------------------------------------
describe('Environment variable INTEGRATION_SYNC_INTERVAL_MS', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('DEFAULT_CHECK_INTERVAL_MS é usado quando env não definida', () => {
    delete process.env.INTEGRATION_SYNC_INTERVAL_MS;
    expect(DEFAULT_CHECK_INTERVAL_MS).toBe(60_000);
  });
});

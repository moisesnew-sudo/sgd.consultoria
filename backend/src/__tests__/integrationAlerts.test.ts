import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, run, all } from '../database.js';
import { runCleanup } from '../server.js';

/**
 * Fase D1.2 — Infraestrutura persistente da Central de Alertas Inteligentes.
 * Valida a tabela integration_alerts: schema, FKs, CHECK constraints, índices,
 * deduplicação funcional (índice parcial UNIQUE) e política de retenção.
 */

const cleanupSystems: number[] = [];
const cleanupAlertIds: number[] = [];

async function createTestSystem(code: string): Promise<number> {
  const res = await run(
    `INSERT INTO integration_systems (code, name, secret_env_key)
     VALUES ($1, $2, 'TEST_ALERT_SECRET')
     RETURNING id`,
    [code, `Sistema Alertas ${code}`]
  );
  const id = res.rows[0].id as number;
  cleanupSystems.push(id);
  return id;
}

async function insertAlert(opts: {
  systemId: number;
  severity?: string;
  type: string;
  message?: string;
  details?: unknown;
  status?: string;
  updatedAt?: string;
}): Promise<number> {
  const res = await run(
    `INSERT INTO integration_alerts (system_id, severity, type, message, details, status, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id`,
    [
      opts.systemId,
      opts.severity ?? 'warning',
      opts.type,
      opts.message ?? `Alerta ${opts.type}`,
      opts.details ? JSON.stringify(opts.details) : null,
      opts.status ?? 'open',
      opts.updatedAt ?? new Date().toISOString(),
    ]
  );
  const id = res.rows[0].id as number;
  cleanupAlertIds.push(id);
  return id;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeAll(async () => {
  // Garante a existência de um usuário real para os testes de FK acknowledged_by/resolved_by.
  const existing = await get<{ id: number }>('SELECT id FROM users WHERE email = $1', ['admin@sgd.gov.br']);
  if (!existing) {
    throw new Error('Usuário admin@sgd.gov.br não encontrado — runSeed deve criar no global-setup');
  }
});

afterAll(async () => {
  if (cleanupAlertIds.length > 0) {
    await run('DELETE FROM integration_alerts WHERE id = ANY($1::int[])', [cleanupAlertIds]);
  }
  if (cleanupSystems.length > 0) {
    await run('DELETE FROM integration_systems WHERE id = ANY($1::int[])', [cleanupSystems]);
  }
});

describe('integration_alerts — infraestrutura (Fase D1.2)', () => {
  it('1. tabela existe após initDatabase', async () => {
    const row = await get<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integration_alerts'`
    );
    expect(row?.table_name).toBe('integration_alerts');
  });

  it('2. colunas obrigatórias existem com os tipos esperados', async () => {
    const cols = await all<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'integration_alerts'`
    );
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    const expected = [
      'id', 'system_id', 'severity', 'type', 'message', 'details',
      'status', 'acknowledged_by', 'acknowledged_at', 'resolved_by',
      'resolved_at', 'created_at', 'updated_at', 'tenant_id',
    ];
    for (const col of expected) {
      expect(byName[col], `coluna ${col}`).toBeDefined();
    }
    expect(byName['details'].data_type).toBe('jsonb');
    expect(byName['system_id'].is_nullable).toBe('NO');
  });

  it('3. FK system_id referencia integration_systems(id) e rejeita id inexistente', async () => {
    await expect(
      run(
        `INSERT INTO integration_alerts (system_id, type) VALUES ($1, $2)`,
        [999999999, 'consecutive_failures']
      )
    ).rejects.toThrow();

    const sysId = await createTestSystem('fk-sys');
    const id = await insertAlert({ systemId: sysId, type: 'consecutive_failures' });
    expect(id).toBeGreaterThan(0);
  });

  it('4. FK acknowledged_by/resolved_by referencia users(id) e rejeita id inexistente', async () => {
    const admin = await get<{ id: number }>('SELECT id FROM users WHERE email = $1', ['admin@sgd.gov.br']);
    const sysId = await createTestSystem('fk-user');

    await expect(
      run(
        `INSERT INTO integration_alerts (system_id, type, acknowledged_by) VALUES ($1, $2, $3)`,
        [sysId, 'high_latency', 999999999]
      )
    ).rejects.toThrow();

    await expect(
      run(
        `INSERT INTO integration_alerts (system_id, type, resolved_by) VALUES ($1, $2, $3)`,
        [sysId, 'stale_sync', 999999999]
      )
    ).rejects.toThrow();

    const id = await insertAlert({ systemId: sysId, type: 'high_latency', status: 'acknowledged' });
    await run('UPDATE integration_alerts SET acknowledged_by = $1 WHERE id = $2', [admin!.id, id]);
    const row = await get<{ acknowledged_by: number }>('SELECT acknowledged_by FROM integration_alerts WHERE id = $1', [id]);
    expect(row?.acknowledged_by).toBe(admin!.id);
  });

  it('5. severity inválida é rejeitada por CHECK constraint', async () => {
    const sysId = await createTestSystem('sev-bad');
    await expect(
      run(
        `INSERT INTO integration_alerts (system_id, severity, type) VALUES ($1, $2, $3)`,
        [sysId, 'severe', 'error_spike']
      )
    ).rejects.toThrow();
  });

  it('6. status inválido é rejeitado por CHECK constraint', async () => {
    const sysId = await createTestSystem('status-bad');
    await expect(
      run(
        `INSERT INTO integration_alerts (system_id, type, status) VALUES ($1, $2, $3)`,
        [sysId, 'error_spike', 'closed']
      )
    ).rejects.toThrow();
  });

  it('7. inserção de alerta válido funciona e defaults são aplicados', async () => {
    const sysId = await createTestSystem('valid');
    const id = await insertAlert({ systemId: sysId, type: 'http_5xx' });
    const row = await get<{ severity: string; status: string; created_at: string }>(
      'SELECT severity, status, created_at FROM integration_alerts WHERE id = $1', [id]
    );
    expect(row?.severity).toBe('warning');
    expect(row?.status).toBe('open');
    expect(row?.created_at).toBeTruthy();
  });

  it('8. details JSONB armazena e recupera contexto operacional', async () => {
    const sysId = await createTestSystem('details');
    const details = { http_status: 503, error_message: 'Service unavailable', count: 3, nested: { ok: true } };
    const id = await insertAlert({ systemId: sysId, type: 'http_5xx', details });
    const row = await get<{ details: any }>('SELECT details FROM integration_alerts WHERE id = $1', [id]);
    expect(row?.details).toEqual(details);
    expect(row?.details?.nested?.ok).toBe(true);
  });

  describe('deduplicação funcional (índice parcial UNIQUE (system_id, type) WHERE status IN open/acknowledged)', () => {
    it('9. permite um alerta open por (system_id, type)', async () => {
      const sysId = await createTestSystem('dedup-open');
      const id = await insertAlert({ systemId: sysId, type: 'consecutive_failures' });
      expect(id).toBeGreaterThan(0);
    });

    it('10. rejeita segundo alerta open do mesmo (system_id, type)', async () => {
      const sysId = await createTestSystem('dedup-open-2');
      await insertAlert({ systemId: sysId, type: 'error_spike' });
      await expect(
        run(
          `INSERT INTO integration_alerts (system_id, type) VALUES ($1, $2)`,
          [sysId, 'error_spike']
        )
      ).rejects.toThrow();
    });

    it('11. permite acknowledged no mesmo alerta via UPDATE (sem duplicar)', async () => {
      const sysId = await createTestSystem('dedup-ack');
      const id = await insertAlert({ systemId: sysId, type: 'high_latency' });
      await run('UPDATE integration_alerts SET status = $1, updated_at = NOW() WHERE id = $2', ['acknowledged', id]);
      const row = await get<{ status: string }>('SELECT status FROM integration_alerts WHERE id = $1', [id]);
      expect(row?.status).toBe('acknowledged');
      const count = await get<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM integration_alerts WHERE system_id = $1 AND type = $2 AND status IN ('open','acknowledged')",
        [sysId, 'high_latency']
      );
      expect(count?.n).toBe(1);
    });

    it('12. permite novo alerta do mesmo tipo após o anterior estar resolved', async () => {
      const sysId = await createTestSystem('dedup-resolved');
      const id = await insertAlert({ systemId: sysId, type: 'stale_sync' });
      await run('UPDATE integration_alerts SET status = $1, resolved_at = NOW(), updated_at = NOW() WHERE id = $2', ['resolved', id]);

      const newId = await insertAlert({ systemId: sysId, type: 'stale_sync' });
      expect(newId).toBeGreaterThan(0);
      const count = await get<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM integration_alerts WHERE system_id = $1 AND type = $2',
        [sysId, 'stale_sync']
      );
      expect(count?.n).toBe(2);
    });

    it('13. permite tipos diferentes para o mesmo sistema simultaneamente', async () => {
      const sysId = await createTestSystem('dedup-multi');
      await insertAlert({ systemId: sysId, type: 'consecutive_failures' });
      await insertAlert({ systemId: sysId, type: 'high_latency' });
      await insertAlert({ systemId: sysId, type: 'unmatched_events' });
      const count = await get<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM integration_alerts WHERE system_id = $1 AND status = $2',
        [sysId, 'open']
      );
      expect(count?.n).toBe(3);
    });
  });

  describe('política de retenção (runCleanup)', () => {
    it('14. cleanup remove apenas alertas resolved com mais de 90 dias', async () => {
      const sysId = await createTestSystem('retention');
      const id = await insertAlert({
        systemId: sysId,
        type: 'http_5xx',
        status: 'resolved',
        updatedAt: daysAgo(91),
      });

      await runCleanup();

      const after = await get<{ id: number }>('SELECT id FROM integration_alerts WHERE id = $1', [id]);
      expect(after).toBeUndefined();
    });

    it('15. cleanup NÃO remove alertas open ou acknowledged, mesmo antigos', async () => {
      const sysId = await createTestSystem('retention-keep');
      const openId = await insertAlert({
        systemId: sysId,
        type: 'consecutive_failures',
        status: 'open',
        updatedAt: daysAgo(120),
      });
      const ackId = await insertAlert({
        systemId: sysId,
        type: 'high_latency',
        status: 'acknowledged',
        updatedAt: daysAgo(120),
      });

      await runCleanup();

      const open = await get<{ id: number }>('SELECT id FROM integration_alerts WHERE id = $1', [openId]);
      const ack = await get<{ id: number }>('SELECT id FROM integration_alerts WHERE id = $1', [ackId]);
      expect(open?.id).toBe(openId);
      expect(ack?.id).toBe(ackId);
    });

    it('16. cleanup NÃO remove alerta resolved recente (dentro de 90 dias)', async () => {
      const sysId = await createTestSystem('retention-recent');
      const id = await insertAlert({
        systemId: sysId,
        type: 'system_inactive',
        status: 'resolved',
        updatedAt: daysAgo(10),
      });

      await runCleanup();

      const after = await get<{ id: number }>('SELECT id FROM integration_alerts WHERE id = $1', [id]);
      expect(after?.id).toBe(id);
    });
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { run } from '../database.js';
import { getMappedStatus } from '../lib/statusMapping.js';

const TEST_SECRET_ENV = 'MAPTESTE_WEBHOOK_SECRET';

async function getSystemId(code: string): Promise<number> {
  const row = await run('SELECT id FROM integration_systems WHERE code = $1', [code]);
  return row.rows[0].id;
}

beforeAll(async () => {
  process.env[TEST_SECRET_ENV] = 'mapteste-webhook-secret-1234567890';

  await run('DELETE FROM integration_status_mapping WHERE system_id IN (SELECT id FROM integration_systems WHERE code IN ($1, $2, $3))', ['maptest1', 'maptest2', 'maptest3']);
  await run('DELETE FROM integration_systems WHERE code IN ($1, $2, $3)', ['maptest1', 'maptest2', 'maptest3']);

  await run("INSERT INTO integration_systems (code, name, secret_env_key) VALUES ('maptest1', 'Mapeamento Teste 1', $1)", [TEST_SECRET_ENV]);
  await run("INSERT INTO integration_systems (code, name, secret_env_key) VALUES ('maptest2', 'Mapeamento Teste 2', $1)", [TEST_SECRET_ENV]);
  await run("INSERT INTO integration_systems (code, name, secret_env_key, active) VALUES ('maptest3', 'Mapeamento Inativo', $1, FALSE)", [TEST_SECRET_ENV]);

  const id1 = await getSystemId('maptest1');
  const id2 = await getSystemId('maptest2');
  const id3 = await getSystemId('maptest3');

  await run(
    `INSERT INTO integration_status_mapping (system_id, external_status, internal_status, description) VALUES
      ($1, 'EM_ANALISE', 'pendente', 'mesmo status externo, resultado diferente (1)'),
      ($1, 'DESATIVADA', 'analise', 'regra a ser desativada no teste'),
      ($2, 'EM_ANALISE', 'concluido', 'mesmo status externo, resultado diferente (2)'),
      ($3, 'EM_ANALISE', 'concluido', 'sistema inativo')`,
    [id1, id2, id3]
  );
});

describe('Status Mapping (mapeamento externo -> interno)', () => {
  it('retorna status SGD correto para status externo conhecido (seed Transferegov)', async () => {
    const r = await getMappedStatus('transferegov', 'APROVADO');
    expect(r.found).toBe(true);
    expect(r.internalStatus).toBe('concluido');
  });

  it('retorna status correto para todos os mapeamentos seedados', async () => {
    const cases: [string, string, string][] = [
      ['transferegov', 'EM_ANALISE', 'analise'],
      ['transferegov', 'PENDENTE', 'pendente'],
      ['transferegov', 'CANCELADO', 'rejeitado'],
      ['sei', 'TRAMITANDO', 'analise'],
      ['sei', 'FINALIZADO', 'concluido'],
      ['cglog', 'EM_ANALISE', 'analise'],
      ['cglog', 'CONCLUIDO', 'concluido'],
      ['cglog', 'CANCELADO', 'rejeitado'],
    ];
    for (const [system, external, expected] of cases) {
      const r = await getMappedStatus(system, external);
      expect(r.found, `${system} ${external}`).toBe(true);
      expect(r.internalStatus, `${system} ${external}`).toBe(expected);
    }
  });

  it('é case-insensitive na busca do status externo', async () => {
    const r = await getMappedStatus('transferegov', 'aprovado');
    expect(r.found).toBe(true);
    expect(r.internalStatus).toBe('concluido');
  });

  it('retorna found=false para status externo inexistente (sem mapeamento ativo)', async () => {
    const r = await getMappedStatus('transferegov', 'STATUS_DESCONHECIDO');
    expect(r.found).toBe(false);
    expect(r.internalStatus).toBeNull();
  });

  it('não retorna regra desativada (active=FALSE)', async () => {
    const id1 = await getSystemId('maptest1');
    await run('UPDATE integration_status_mapping SET active = FALSE WHERE system_id = $1 AND external_status = $2', [id1, 'DESATIVADA']);

    const r = await getMappedStatus('maptest1', 'DESATIVADA');
    expect(r.found).toBe(false);
    expect(r.internalStatus).toBeNull();
  });

  it('sistemas diferentes com o mesmo status externo retornam resultados diferentes', async () => {
    const r1 = await getMappedStatus('maptest1', 'EM_ANALISE');
    const r2 = await getMappedStatus('maptest2', 'EM_ANALISE');
    expect(r1.found).toBe(true);
    expect(r2.found).toBe(true);
    expect(r1.internalStatus).toBe('pendente');
    expect(r2.internalStatus).toBe('concluido');
    expect(r1.internalStatus).not.toBe(r2.internalStatus);
  });

  it('não retorna mapeamento de sistema inativo', async () => {
    const r = await getMappedStatus('maptest3', 'EM_ANALISE');
    expect(r.found).toBe(false);
    expect(r.internalStatus).toBeNull();
  });

  it('retorna found=false para sistema inexistente', async () => {
    const r = await getMappedStatus('sistema_inexistente', 'APROVADO');
    expect(r.found).toBe(false);
    expect(r.internalStatus).toBeNull();
  });
});

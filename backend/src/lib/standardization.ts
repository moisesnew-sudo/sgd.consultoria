import { all, run } from '../database.js';
import {
  canonicalMunicipality,
  findOfficialMunicipality,
  municipalityKey,
  regionForUf,
} from './text.js';

export interface StdChange {
  value: string;
  uf: string;
  correctedTo: string;
}

export interface StdManual {
  value: string;
  uf: string;
  reason: string;
}

export interface StdReport {
  applied: boolean;
  municipalities: {
    total: number;
    canonicalized: StdChange[];
    duplicates: StdManual[];
    notInIbge: StdManual[];
  };
  demands: {
    total: number;
    distinct: number;
    corrected: StdChange[];
    notInIbge: StdManual[];
  };
}

interface MunicipalityRow {
  id: number;
  name: string;
  uf: string;
}

interface DemandPairRow {
  municipality: string;
  uf: string;
}

function cityKey(name: string, uf: string): string {
  return `${municipalityKey(name)}|${uf.trim().toUpperCase()}`;
}

function addChange(target: StdChange[], value: string, uf: string, correctedTo: string) {
  if (!target.some(c => c.value === value && c.uf === uf && c.correctedTo === correctedTo)) {
    target.push({ value, uf, correctedTo });
  }
}

function addManual(target: StdManual[], value: string, uf: string, reason: string) {
  if (!target.some(c => c.value === value && c.uf === uf)) {
    target.push({ value, uf, reason });
  }
}

export async function buildStandardizationScan(tenantId: number): Promise<StdReport> {
  const mRows = await all<MunicipalityRow>(
    'SELECT id, name, uf FROM municipalities WHERE tenant_id = $1 AND deleted_at IS NULL',
    [tenantId]
  );
  const demPairs = await all<DemandPairRow>(
    `SELECT DISTINCT municipality, uf FROM demands
     WHERE tenant_id = $1 AND deleted_at IS NULL AND municipality IS NOT NULL AND municipality <> ''`,
    [tenantId]
  );
  const demTotal = await all<{ id: string }>('SELECT id FROM demands WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId]);

  // Municípios
  const canonicalized: StdChange[] = [];
  const duplicates: StdManual[] = [];
  const notInIbgeC: StdManual[] = [];

  const groups = new Map<string, MunicipalityRow[]>();
  const officialById = new Map<number, { name: string; uf: string }>();

  for (const r of mRows) {
    const official = findOfficialMunicipality(r.name, r.uf);
    if (!official) {
      addManual(notInIbgeC, r.name, r.uf, 'Município não encontrado na base oficial do IBGE');
      continue;
    }
    officialById.set(r.id, { name: official.nome, uf: official.uf });
    const gk = cityKey(official.nome, official.uf);
    const g = groups.get(gk) || [];
    g.push(r);
    groups.set(gk, g);
  }

  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const primary = g[0];
    for (const dup of g.slice(1)) {
      addManual(duplicates, dup.name, dup.uf, `Duplicata de ${primary.name} (${primary.uf})`);
    }
  }

  for (const r of mRows) {
    const official = officialById.get(r.id);
    if (official && (official.name !== r.name || official.uf !== r.uf)) {
      addChange(canonicalized, r.name, r.uf, `${official.name} (${official.uf})`);
    }
  }

  // Demandas
  const demCorrected: StdChange[] = [];
  const demNotIn: StdManual[] = [];

  for (const d of demPairs) {
    const official = canonicalMunicipality(d.municipality, d.uf);
    if (!official) {
      addManual(demNotIn, d.municipality, d.uf, 'Município não encontrado na base oficial do IBGE');
      continue;
    }
    if (official.nome !== d.municipality || official.uf !== d.uf) {
      addChange(demCorrected, d.municipality, d.uf, `${official.nome} (${official.uf})`);
    }
  }

  return {
    applied: false,
    municipalities: { total: mRows.length, canonicalized, duplicates, notInIbge: notInIbgeC },
    demands: {
      total: demTotal.length,
      distinct: demPairs.length,
      corrected: demCorrected,
      notInIbge: demNotIn,
    },
  };
}

/** Renomeia um município para a grafia oficial sem violar o UNIQUE(name, uf):
 *  se outra linha (ativa ou soft-deletada) já ocupa o par, descarta esta linha e
 *  garante que a linha oficial fique ativa. */
async function renameMunicipalitySafely(rowId: number, name: string, uf: string, tenantId: number): Promise<void> {
  const clash = await all<{ id: number; deleted_at: Date | null }>(
    'SELECT id, deleted_at FROM municipalities WHERE tenant_id = $1 AND id <> $2 AND name = $3 AND uf = $4',
    [tenantId, rowId, name, uf]
  );
  if (clash.length > 0) {
    const softDeleted = clash.find(c => c.deleted_at);
    if (softDeleted) {
      await run('UPDATE municipalities SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND tenant_id = $2', [softDeleted.id, tenantId]);
    }
    await run('UPDATE municipalities SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2', [rowId, tenantId]);
    return;
  }
  await run(
    'UPDATE municipalities SET name = $1, uf = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4',
    [name, uf, rowId, tenantId]
  );
}

async function recomputeCounters(tenantId: number) {
  await run(
    `UPDATE municipalities SET demands_count = 0, total_value = 0, updated_at = NOW()
     WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId]
  );
  await run(
    `UPDATE municipalities m SET
        demands_count = d.cnt,
        total_value = d.val,
        updated_at = NOW()
      FROM (
        SELECT municipality, uf, COUNT(*) cnt, COALESCE(SUM(requested_value), 0) val
        FROM demands WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY municipality, uf
      ) d
      WHERE m.tenant_id = $1 AND m.name = d.municipality AND m.uf = d.uf AND m.deleted_at IS NULL`,
    [tenantId]
  );
}

async function canonicalizeDemands(tenantId: number) {
  const pairs = await all<DemandPairRow>(
    `SELECT DISTINCT municipality, uf FROM demands
     WHERE tenant_id = $1 AND municipality IS NOT NULL AND municipality <> ''`,
    [tenantId]
  );
  for (const d of pairs) {
    const official = canonicalMunicipality(d.municipality, d.uf);
    if (!official) continue;
    if (official.nome !== d.municipality || official.uf !== d.uf) {
      await run(
        `UPDATE demands SET municipality = $1, uf = $2 WHERE tenant_id = $3 AND municipality = $4 AND uf = $5`,
        [official.nome, official.uf, tenantId, d.municipality, d.uf]
      );
    }
  }
}

export async function applyStandardizationScan(tenantId: number): Promise<StdReport> {
  const mRows = await all<MunicipalityRow>(
    'SELECT id, name, uf FROM municipalities WHERE tenant_id = $1 AND deleted_at IS NULL',
    [tenantId]
  );

  // 1) Mescla duplicatas que resolvem para o mesmo município oficial do IBGE.
  const groups = new Map<string, MunicipalityRow[]>();
  const officialById = new Map<number, { name: string; uf: string }>();
  for (const r of mRows) {
    const official = findOfficialMunicipality(r.name, r.uf);
    if (!official) continue;
    officialById.set(r.id, { name: official.nome, uf: official.uf });
    const gk = cityKey(official.nome, official.uf);
    const g = groups.get(gk) || [];
    g.push(r);
    groups.set(gk, g);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const official = officialById.get(g[0].id)!;
    // Mantém como referência o registro que já possui a grafia oficial (se existir),
    // evitando violar o UNIQUE(name, uf) ao renomear.
    const keeper = g.find(r => r.name === official.name && r.uf === official.uf) || g[0];
    for (const r of g) {
      if (r.id === keeper.id) continue;
      await run(
        `UPDATE demands SET municipality = $1, uf = $2 WHERE tenant_id = $3 AND municipality = $4 AND uf = $5`,
        [official.name, official.uf, tenantId, r.name, r.uf]
      );
      await run('UPDATE municipalities SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2', [r.id, tenantId]);
    }
    if (keeper.name !== official.name || keeper.uf !== official.uf) {
      await renameMunicipalitySafely(keeper.id, official.name, official.uf, tenantId);
    }
  }

  // 2) Canoniza nomes restantes (sem conflito de UNIQUE, pois duplicatas foram mescladas).
  const remaining = await all<MunicipalityRow>(
    'SELECT id, name, uf FROM municipalities WHERE tenant_id = $1 AND deleted_at IS NULL',
    [tenantId]
  );
  for (const r of remaining) {
    const official = findOfficialMunicipality(r.name, r.uf);
    if (official && (official.nome !== r.name || official.uf !== r.uf)) {
      await renameMunicipalitySafely(r.id, official.nome, official.uf, tenantId);
    }
  }

  // 3) Canoniza os municípios gravados nas demandas para a grafia oficial.
  await canonicalizeDemands(tenantId);

  // 4) Garante uma linha de município oficial para cada cidade citada nas demandas.
  const distinct = await all<DemandPairRow>(
    `SELECT DISTINCT municipality, uf FROM demands
     WHERE tenant_id = $1 AND municipality IS NOT NULL AND municipality <> ''`,
    [tenantId]
  );
  for (const d of distinct) {
    const official = canonicalMunicipality(d.municipality, d.uf);
    if (!official) continue;
    await run(
      `INSERT INTO municipalities (name, uf, demands_count, total_value, region, tenant_id)
       VALUES ($1, $2, 0, 0, $3, $4)
       ON CONFLICT (tenant_id, name, uf) DO UPDATE SET deleted_at = NULL, updated_at = NOW()`,
      [official.nome, official.uf, regionForUf(official.uf), tenantId]
    );
  }

  // 5) Recompor métricas a partir das demandas ativas.
  await recomputeCounters(tenantId);

  return buildStandardizationScan(tenantId);
}
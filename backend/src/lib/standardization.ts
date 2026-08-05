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

export async function buildStandardizationScan(): Promise<StdReport> {
  const mRows = await all<MunicipalityRow>(
    'SELECT id, name, uf FROM municipalities WHERE deleted_at IS NULL'
  );
  const demPairs = await all<DemandPairRow>(
    `SELECT DISTINCT municipality, uf FROM demands
     WHERE deleted_at IS NULL AND municipality IS NOT NULL AND municipality <> ''`
  );
  const demTotal = await all<{ id: string }>('SELECT id FROM demands WHERE deleted_at IS NULL');

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

async function recomputeCounters() {
  await run(
    `UPDATE municipalities SET demands_count = 0, total_value = 0, updated_at = NOW()
     WHERE deleted_at IS NULL`
  );
  await run(
    `UPDATE municipalities m SET
        demands_count = d.cnt,
        total_value = d.val,
        updated_at = NOW()
      FROM (
        SELECT municipality, uf, COUNT(*) cnt, COALESCE(SUM(requested_value), 0) val
        FROM demands WHERE deleted_at IS NULL GROUP BY municipality, uf
      ) d
      WHERE m.name = d.municipality AND m.uf = d.uf AND m.deleted_at IS NULL`
  );
}

async function canonicalizeDemands() {
  const pairs = await all<DemandPairRow>(
    `SELECT DISTINCT municipality, uf FROM demands
     WHERE municipality IS NOT NULL AND municipality <> ''`
  );
  for (const d of pairs) {
    const official = canonicalMunicipality(d.municipality, d.uf);
    if (!official) continue;
    if (official.nome !== d.municipality || official.uf !== d.uf) {
      await run(
        `UPDATE demands SET municipality = $1, uf = $2 WHERE municipality = $3 AND uf = $4`,
        [official.nome, official.uf, d.municipality, d.uf]
      );
    }
  }
}

export async function applyStandardizationScan(): Promise<StdReport> {
  const mRows = await all<MunicipalityRow>(
    'SELECT id, name, uf FROM municipalities WHERE deleted_at IS NULL'
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
        `UPDATE demands SET municipality = $1, uf = $2 WHERE municipality = $3 AND uf = $4`,
        [official.name, official.uf, r.name, r.uf]
      );
      await run('UPDATE municipalities SET deleted_at = NOW() WHERE id = $1', [r.id]);
    }
    if (keeper.name !== official.name || keeper.uf !== official.uf) {
      await run(
        'UPDATE municipalities SET name = $1, uf = $2, updated_at = NOW() WHERE id = $3',
        [official.name, official.uf, keeper.id]
      );
    }
  }

  // 2) Canoniza nomes restantes (sem conflito de UNIQUE, pois duplicatas foram mescladas).
  const remaining = await all<MunicipalityRow>(
    'SELECT id, name, uf FROM municipalities WHERE deleted_at IS NULL'
  );
  for (const r of remaining) {
    const official = findOfficialMunicipality(r.name, r.uf);
    if (official && (official.nome !== r.name || official.uf !== r.uf)) {
      await run(
        'UPDATE municipalities SET name = $1, uf = $2, updated_at = NOW() WHERE id = $3',
        [official.nome, official.uf, r.id]
      );
    }
  }

  // 3) Canoniza os municípios gravados nas demandas para a grafia oficial.
  await canonicalizeDemands();

  // 4) Garante uma linha de município oficial para cada cidade citada nas demandas.
  const distinct = await all<DemandPairRow>(
    `SELECT DISTINCT municipality, uf FROM demands
     WHERE municipality IS NOT NULL AND municipality <> ''`
  );
  for (const d of distinct) {
    const official = canonicalMunicipality(d.municipality, d.uf);
    if (!official) continue;
    await run(
      `INSERT INTO municipalities (name, uf, demands_count, total_value, region)
       VALUES ($1, $2, 0, 0, $3)
       ON CONFLICT (name, uf) DO NOTHING`,
      [official.nome, official.uf, regionForUf(official.uf)]
    );
  }

  // 5) Recompor métricas a partir das demandas ativas.
  await recomputeCounters();

  return buildStandardizationScan();
}
import ibgeMunicipalities from '../data/ibge-municipalities.json';

export type Region = 'Norte' | 'Nordeste' | 'Sudeste' | 'Sul' | 'Centro-Oeste';

export interface MunicipalityRef {
  nome: string;
  uf: string;
}

interface RawCity {
  nome: string;
  uf: string;
}

const rawCities = ibgeMunicipalities as unknown as RawCity[];

const UF_REGION: Record<string, Region> = {
  AC: 'Norte', AP: 'Norte', AM: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste',
  PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste',
};

// ---------------------------------------------------------------------------
// Normalização básica de texto (unicode/caixa/colapsos)
// ---------------------------------------------------------------------------

/**
 * Normaliza um texto: NFC, remove quebras estranhas (espaço não separável etc),
 * colapsa múltiplos espaços e remove espaços nas bordas. Preserva os acentos.
 */
export function normalizeText(s: unknown): string {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[\u00A0\u2007\u202F\u2000-\u200A\u00AD]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chave de comparação: sem acentos, sem caixa, sem espaços múltiplos.
 * Usada para comparações "inteligentes" (ex.: CÁCERES == CACERES).
 */
export function comparisonKey(s: unknown): string {
  return normalizeText(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function municipalityKey(name: unknown): string {
  return comparisonKey(name);
}

export function regionForUf(uf: unknown): Region | undefined {
  const u = uf ? String(uf).trim().toUpperCase() : '';
  return UF_REGION[u];
}

// ---------------------------------------------------------------------------
// Índice da base oficial (IBGE) de municípios
// ---------------------------------------------------------------------------

let indexBuilt = false;
const keyToCities = new Map<string, RawCity[]>();
const ufToCities = new Map<string, RawCity[]>();

function buildIndex() {
  if (indexBuilt) return;
  for (const c of rawCities) {
    const key = municipalityKey(c.nome);
    const bucket = keyToCities.get(key);
    if (bucket) bucket.push(c);
    else keyToCities.set(key, [c]);

    const uf = c.uf;
    const ufb = ufToCities.get(uf);
    if (ufb) ufb.push(c);
    else ufToCities.set(uf, [c]);
  }
  for (const arr of keyToCities.values()) arr.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  for (const arr of ufToCities.values()) arr.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  indexBuilt = true;
}

/** Retorna a referência canônica do município (nome+UF oficiais do IBGE) ou null. */
export function canonicalMunicipality(name: unknown, uf?: unknown): MunicipalityRef | null {
  buildIndex();
  const key = municipalityKey(name);
  const arr = keyToCities.get(key) || [];
  if (arr.length === 0) return null;

  // Nome resolvido de forma única na base IBGE -> UF autoritativa é a oficial.
  if (arr.length === 1) {
    const hit = arr[0];
    return { nome: normalizeText(hit.nome).toUpperCase(), uf: hit.uf };
  }

  // Nome com duplicidade entre UFs -> exige UF informada para desempatar.
  const ufU = uf ? String(uf).trim().toUpperCase() : '';
  if (ufU) {
    const hit = arr.find(c => c.uf === ufU);
    if (hit) return { nome: normalizeText(hit.nome).toUpperCase(), uf: hit.uf };
  }
  return null;
}

/**
 * Verifica a existência do par (nome, UF) na base oficial do IBGE.
 * Exige correspondência exata entre nome e UF (para cadastro de município).
 */
export function findOfficialMunicipality(name: unknown, uf: unknown): MunicipalityRef | null {
  buildIndex();
  const key = municipalityKey(name);
  const arr = keyToCities.get(key) || [];
  const ufU = uf ? String(uf).trim().toUpperCase() : '';
  if (arr.length === 0) return null;
  if (ufU) {
    const hit = arr.find(c => c.uf === ufU);
    if (hit) return { nome: normalizeText(hit.nome).toUpperCase(), uf: hit.uf };
    return null;
  }
  if (arr.length === 1) return { nome: normalizeText(arr[0].nome).toUpperCase(), uf: arr[0].uf };
  return null;
}

/** Sugestões oficiais para autocompletar (Busca por prefixo, sem sensibilidade a acento/caixa). */
export function suggestMunicipalities(query: unknown, uf?: unknown, limit = 25): MunicipalityRef[] {
  buildIndex();
  const q = municipalityKey(query);
  if (!q) return [];
  const pool = uf
    ? ufToCities.get(String(uf).trim().toUpperCase()) || []
    : rawCities;
  const out: MunicipalityRef[] = [];
  for (const c of pool) {
    if (municipalityKey(c.nome).startsWith(q)) {
      out.push({ nome: normalizeText(c.nome).toUpperCase(), uf: c.uf });
      if (out.length >= limit) break;
    }
  }
  return out;
}
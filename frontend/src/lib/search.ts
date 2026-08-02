import type { Demand } from '../types';
import { statusLabel, priorityLabel } from './demandMeta';

/* ---------------------------------------------------------------------------
 * Normalização (busca sem acento, case-insensitive)
 * ------------------------------------------------------------------------- */

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------------------------------------------------------------------------
 * Pesquisa estruturada: "campo:valor"
 * Suporta: municipio, objeto, status, orgao, numero, valor, usuario, ano,
 *          uf, categoria, prioridade (+ aliases)
 * ------------------------------------------------------------------------- */

export interface ParsedQuery {
  free: string;
  municipality?: string;
  object?: string;
  status?: string;
  organ?: string;
  number?: string;
  value?: string;
  user?: string;
  year?: string;
  uf?: string;
  category?: string;
  priority?: string;
}

const FIELD_ALIASES: Record<string, keyof ParsedQuery> = {
  municipio: 'municipality',
  municipios: 'municipality',
  mun: 'municipality',
  objeto: 'object',
  obj: 'object',
  status: 'status',
  st: 'status',
  orgao: 'organ',
  org: 'organ',
  numero: 'number',
  num: 'number',
  proposta: 'number',
  valor: 'value',
  val: 'value',
  usuario: 'user',
  responsavel: 'user',
  user: 'user',
  ano: 'year',
  uf: 'uf',
  categoria: 'category',
  prioridade: 'priority',
};

const FIELD_PATTERN = /(?:^|\s)(municipios?|mun|objeto|obj|status|st|orgao|org|numero|num|proposta|valor|val|usuario|responsavel|user|ano|uf|categoria|prioridade):/gi;

export function parseFieldQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { free: '' };
  const trimmed = raw.trim();
  if (!trimmed) return parsed;

  const matches: { index: number; end: number; field: string }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(FIELD_PATTERN.source, 'gi');
  while ((m = re.exec(trimmed))) {
    const lead = m[0][0] === ' ' ? 1 : 0;
    matches.push({
      index: m.index + lead,
      end: m.index + m[0].length,
      field: m[0].trim().slice(0, -1).toLowerCase(),
    });
  }

  if (matches.length === 0) {
    parsed.free = trimmed;
    return parsed;
  }

  const freeParts: string[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    freeParts.push(trimmed.slice(cursor, cur.index));
    const next = matches[i + 1];
    const valueEnd = next ? next.index : trimmed.length;
    const value = trimmed.slice(cur.end, valueEnd).trim();
    const key = FIELD_ALIASES[cur.field];
    if (value && key !== 'free') {
      const prev = parsed[key];
      parsed[key] = prev ? `${prev} ${value}` : value;
    }
    cursor = valueEnd;
  }
  freeParts.push(trimmed.slice(cursor));
  parsed.free = freeParts.join(' ').replace(/\s+/g, ' ').trim();
  return parsed;
}

/* ---------------------------------------------------------------------------
 * Correspondência (busca parcial, sem acento)
 * ------------------------------------------------------------------------- */

const parseValueNumber = (s: string): number => {
  const t = s.replace(/\s/g, '');
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  const dots = (t.match(/\./g) || []).length;
  if (dots > 1) return Number(t.replace(/\./g, ''));
  return Number(t.replace(/\./g, ''));
};

const matchesValue = (demandValue: number, raw: string): boolean => {
  const spec = raw.trim();
  const range = spec.match(/^(\d[\d.,]*)\s*-\s*(\d[\d.,]*)$/);
  if (range) {
    const min = parseValueNumber(range[1]);
    const max = parseValueNumber(range[2]);
    return demandValue >= min && demandValue <= max;
  }
  const ge = spec.match(/^(>=|>)\s*([\d.,]+)$/);
  if (ge) {
    const n = parseValueNumber(ge[2]);
    return ge[1] === '>' ? demandValue > n : demandValue >= n;
  }
  const le = spec.match(/^(<=|<)\s*([\d.,]+)$/);
  if (le) {
    const n = parseValueNumber(le[2]);
    return le[1] === '<' ? demandValue < n : demandValue <= n;
  }
  const digits = spec.replace(/\D/g, '');
  if (!digits) return true;
  return String(Math.round(demandValue)).includes(digits);
};

const includesAny = (value: string | undefined, terms: string[]): boolean => {
  const v = normalize(value || '');
  return terms.some(t => t && v.includes(normalize(t)));
};

export function matchesQuery(d: Demand, p: ParsedQuery): boolean {
  if (p.free) {
    const haystack = [
      d.id,
      d.title,
      d.municipality,
      d.description,
      d.category,
      d.organ,
      d.proposal_number,
      d.prefeitura,
      d.responsible_name,
      d.responsible_email,
      d.responsible_phone,
      d.ano ? String(d.ano) : '',
    ];
    const matched = includesAny(haystack.join('\u0001'), p.free.split(/\s+/));
    if (!matched) {
      const digits = p.free.replace(/\D/g, '');
      if (!digits || !String(Math.round(d.requested_value || 0)).includes(digits)) {
        return false;
      }
    }
  }

  if (p.municipality && !includesAny(d.municipality, [p.municipality]) && !includesAny(`${d.municipality}/${d.uf}`, [p.municipality])) return false;
  if (p.object && !includesAny([d.title, d.description, d.category].join('\u0001'), [p.object])) return false;
  if (p.status && !includesAny(statusLabel(d.status), [p.status]) && !includesAny(d.status, [p.status])) return false;
  if (p.organ && !includesAny(d.organ, [p.organ])) return false;
  if (p.number && !includesAny(`${d.proposal_number} ${d.id}`, [p.number])) return false;
  if (p.user && !includesAny(`${d.responsible_name} ${d.responsible_email}`, [p.user])) return false;
  if (p.year && !includesAny(String(d.ano || ''), [p.year])) return false;
  if (p.uf && !includesAny(d.uf, [p.uf])) return false;
  if (p.category && !includesAny(d.category, [p.category])) return false;
  if (p.priority && !includesAny(priorityLabel(d.priority), [p.priority]) && !includesAny(d.priority, [p.priority])) return false;
  if (p.value && !matchesValue(d.requested_value || 0, p.value)) return false;

  return true;
}

/* ---------------------------------------------------------------------------
 * Sugestões de autocomplete
 * ------------------------------------------------------------------------- */

export interface SearchSuggestion {
  id: string;
  label: string;
  sub?: string;
  group: string;
  groupLabel: string;
  insert: string;
  dotCls: string;
}

const COUNT_BY = <T,>(list: T[], key: (item: T) => string): { value: string; count: number }[] => {
  const map = new Map<string, number>();
  for (const item of list) {
    const k = String(key(item) || '').trim();
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
};

export function buildSuggestions(demands: Demand[], raw: string): SearchSuggestion[] {
  const out: SearchSuggestion[] = [];
  const trimmed = raw.trim();
  if (!trimmed) return out;

  const nq = normalize(trimmed);
  const tokens = trimmed.split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  const colonIndex = lastToken.indexOf(':');
  const fieldKey = colonIndex > 0 ? FIELD_ALIASES[lastToken.slice(0, colonIndex).toLowerCase()] : undefined;
  const fieldValuePrefix = fieldKey ? lastToken.slice(colonIndex + 1) : '';

  const pushValues = (
    values: { value: string; count?: number }[],
    field: keyof ParsedQuery,
    group: string,
    groupLabel: string,
    dotCls: string,
    limit: number,
    subPrefix?: string
  ) => {
    const prefix = normalize(fieldValuePrefix);
    const filtered = values.filter(v => !prefix || normalize(v.value).includes(prefix));
    for (const v of filtered.slice(0, limit)) {
      out.push({
        id: `${group}-${v.value}`,
        label: v.value,
        sub: subPrefix ? `${subPrefix}${v.count !== undefined ? ` · ${v.count} demanda(s)` : ''}` : undefined,
        group,
        groupLabel,
        insert: `${lastToken.slice(0, colonIndex + 1)}${v.value}`,
        dotCls,
      });
    }
  };

  if (fieldKey) {
    switch (fieldKey) {
      case 'municipality':
        pushValues(COUNT_BY(demands, d => `${d.municipality}/${d.uf}`), 'municipality', 'municipality', 'Municípios', 'bg-blue-500', 6);
        break;
      case 'organ':
        pushValues(COUNT_BY(demands, d => d.organ), 'organ', 'organ', 'Órgãos', 'bg-purple-500', 5);
        break;
      case 'user':
        pushValues(COUNT_BY(demands, d => d.responsible_name), 'user', 'user', 'Usuários', 'bg-emerald-500', 5);
        break;
      case 'category':
        pushValues(COUNT_BY(demands, d => d.category), 'category', 'category', 'Categorias', 'bg-orange-500', 5);
        break;
      case 'uf':
        pushValues(COUNT_BY(demands, d => d.uf), 'uf', 'uf', 'UFs', 'bg-cyan-500', 5);
        break;
      case 'year':
        pushValues(COUNT_BY(demands, d => String(d.ano || '')), 'year', 'year', 'Anos', 'bg-slate-500', 5);
        break;
      case 'number':
        pushValues(COUNT_BY(demands, d => d.proposal_number || d.id), 'number', 'number', 'Números', 'bg-teal-500', 5);
        break;
      case 'status': {
        const statuses: { value: string; count?: number }[] = [
          { value: 'pendente' }, { value: 'analise' }, { value: 'concluido' }, { value: 'rejeitado' },
        ];
        pushValues(statuses, 'status', 'status', 'Status', 'bg-amber-500', 4);
        break;
      }
      case 'priority': {
        const prios: { value: string; count?: number }[] = [
          { value: 'baixa' }, { value: 'media' }, { value: 'alta' }, { value: 'urgente' },
        ];
        pushValues(prios, 'priority', 'priority', 'Prioridades', 'bg-rose-500', 4);
        break;
      }
      case 'value': {
        const numMatch = fieldValuePrefix.match(/\d[\d.,]*/);
        const n = numMatch ? numMatch[0] : '';
        const spec = lastToken.slice(0, colonIndex + 1);
        if (n) {
          out.push({ id: 'value-gt', label: `> ${n}`, sub: 'Valores acima deste valor', group: 'value', groupLabel: 'Valor', insert: `${spec}>${n}`, dotCls: 'bg-brand-500' });
          out.push({ id: 'value-lt', label: `< ${n}`, sub: 'Valores abaixo deste valor', group: 'value', groupLabel: 'Valor', insert: `${spec}<${n}`, dotCls: 'bg-brand-500' });
        } else {
          out.push({ id: 'value-hint', label: 'valor:>X', sub: 'Acima de um valor', group: 'value', groupLabel: 'Valor', insert: `${spec}>`, dotCls: 'bg-brand-500' });
          out.push({ id: 'value-hint2', label: 'valor:X-Y', sub: 'Intervalo entre valores', group: 'value', groupLabel: 'Valor', insert: `${spec}`, dotCls: 'bg-brand-500' });
        }
        break;
      }
      case 'object': {
        if (fieldValuePrefix) {
          out.push({ id: 'object-hint', label: `objeto:${fieldValuePrefix}`, sub: 'Buscar no objeto (título/descrição)', group: 'object', groupLabel: 'Objeto', insert: `objeto:${fieldValuePrefix}`, dotCls: 'bg-indigo-500' });
        }
        break;
      }
      default:
        break;
    }
    return out;
  }

  const groups: { key: keyof ParsedQuery; field: string; label: string; dot: string; list: { value: string; count: number }[]; limit: number; insertAs?: string }[] = [
    { key: 'municipality', field: 'municipality', label: 'Municípios', dot: 'bg-blue-500', list: COUNT_BY(demands, d => `${d.municipality}/${d.uf}`), limit: 6 },
    { key: 'organ', field: 'organ', label: 'Órgãos', dot: 'bg-purple-500', list: COUNT_BY(demands, d => d.organ), limit: 4 },
    { key: 'user', field: 'user', label: 'Usuários', dot: 'bg-emerald-500', list: COUNT_BY(demands, d => d.responsible_name), limit: 4 },
    { key: 'category', field: 'category', label: 'Categorias', dot: 'bg-orange-500', list: COUNT_BY(demands, d => d.category), limit: 4 },
    { key: 'uf', field: 'uf', label: 'UFs', dot: 'bg-cyan-500', list: COUNT_BY(demands, d => d.uf), limit: 4 },
    { key: 'year', field: 'year', label: 'Anos', dot: 'bg-slate-500', list: COUNT_BY(demands, d => String(d.ano || '')), limit: 4 },
    { key: 'number', field: 'number', label: 'Números', dot: 'bg-teal-500', list: COUNT_BY(demands, d => d.proposal_number || d.id), limit: 3 },
  ];

  for (const g of groups) {
    const matched = g.list.filter(v => normalize(v.value).includes(nq));
    if (matched.length === 0) continue;
    for (const v of matched.slice(0, g.limit)) {
      out.push({
        id: `${g.key}-${v.value}`,
        label: v.value,
        sub: `${v.count} demanda(s)`,
        group: g.key,
        groupLabel: g.label,
        insert: `${g.field}:${v.value}`,
        dotCls: g.dot,
      });
    }
  }

  const statusMatch = ['pendente', 'analise', 'concluido', 'rejeitado'].filter(s => normalize(statusLabel(s as any)).includes(nq));
  for (const s of statusMatch) {
    out.push({ id: `status-${s}`, label: statusLabel(s as any), sub: 'Filtrar por status', group: 'status', groupLabel: 'Status', insert: `status:${s}`, dotCls: 'bg-amber-500' });
  }
  const priorityMatch = ['baixa', 'media', 'alta', 'urgente'].filter(s => normalize(priorityLabel(s as any)).includes(nq));
  for (const s of priorityMatch) {
    out.push({ id: `priority-${s}`, label: priorityLabel(s as any), sub: 'Filtrar por prioridade', group: 'priority', groupLabel: 'Prioridade', insert: `prioridade:${s}`, dotCls: 'bg-rose-500' });
  }

  const fieldShortcuts: { field: string; label: string; insert: string; dot: string }[] = [
    { field: 'municipality', label: 'Buscar por município', insert: 'municipio:', dot: 'bg-blue-500' },
    { field: 'organ', label: 'Buscar por órgão', insert: 'orgao:', dot: 'bg-purple-500' },
    { field: 'user', label: 'Buscar por usuário', insert: 'usuario:', dot: 'bg-emerald-500' },
    { field: 'number', label: 'Buscar por número', insert: 'numero:', dot: 'bg-teal-500' },
    { field: 'value', label: 'Buscar por valor', insert: 'valor:', dot: 'bg-brand-500' },
    { field: 'status', label: 'Buscar por status', insert: 'status:', dot: 'bg-amber-500' },
  ];
  for (const s of fieldShortcuts) {
    out.push({ id: `shortcut-${s.field}`, label: s.label, sub: 'Pesquisa estruturada', group: 'shortcuts', groupLabel: 'Pesquisar em', insert: s.insert, dotCls: s.dot });
  }

  return out;
}

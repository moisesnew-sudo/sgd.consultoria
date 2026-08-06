import { Demand, DemandPriority } from '../types';

const STOPWORDS = new Set([
  'a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'uns', 'umas', 'que', 'por', 'se', 'ao', 'à', 'as', 'os', 'ou', 'entre', 'sob',
  'aos', 'pelas', 'pelos', 'pela', 'pelo', 'sua', 'seu', 'suas', 'seus', 'este', 'esta', 'isso',
  'esta', 'foi', 'ser', 'são', 'nao', 'não', 'dos', 'das', 'the', 'of', 'and', 'to', 'in', 'for'
]);

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// ---- Resumo automático (extrativo, heurística) ----
export function summarizeDemand(d: Demand, maxSentences = 3): string {
  const text = `${d.title}. ${d.description || ''}`.trim();
  if (!text) return 'Demanda sem descrição disponível para resumo.';

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length <= maxSentences) {
    return sentences.join(' ');
  }

  const words = tokenize(text);
  const freq: Record<string, number> = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });

  const scored = sentences.map(s => {
    const sw = tokenize(s);
    const score = sw.reduce((acc, w) => acc + (freq[w] || 0), 0) / Math.max(sw.length, 1);
    return { s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxSentences).map(x => x.s);
  // preserve original order
  const order = sentences.map(s => top.includes(s) ? s : null).filter(Boolean) as string[];
  return order.join(' ');
}

// ---- Sugestão de prioridade (heurística) ----
export function suggestPriority(d: Demand): { priority: DemandPriority; reason: string } {
  const text = `${d.title} ${d.description || ''}`.toLowerCase();
  const value = d.requested_value || 0;
  const signals: { label: string; weight: number }[] = [];

  const urgentWords = ['urgente', 'emergencia', 'emergência', 'imediato', 'risco', 'colapso', 'desabamento', 'incendio', 'incêndio', 'epidemia', 'desastre', 'vida'];
  const highWords = ['creche', 'escola', 'hospital', 'saude', 'saúde', 'água', 'agua', 'esgoto', 'ponte', 'rodovia', 'seguranca', 'segurança'];
  const lowWords = ['pintura', 'paisagismo', 'manutencao', 'manutenção', 'pequeno', 'consultoria', 'estudo', 'planejamento'];

  if (urgentWords.some(w => text.includes(w))) signals.push({ label: 'termos críticos/urgência', weight: 4 });
  if (highWords.some(w => text.includes(w))) signals.push({ label: 'área essencial', weight: 2 });
  if (lowWords.some(w => text.includes(w))) signals.push({ label: 'baixo impacto', weight: -2 });
  if (value >= 5000000) signals.push({ label: 'alto valor (>= R$ 5M)', weight: 3 });
  else if (value >= 1000000) signals.push({ label: 'valor relevante (>= R$ 1M)', weight: 2 });
  else if (value > 0 && value < 100000) signals.push({ label: 'baixo valor', weight: -1 });

  const total = signals.reduce((a, b) => a + b.weight, 0);

  let priority: DemandPriority = 'media';
  if (total >= 4) priority = 'urgente';
  else if (total >= 2) priority = 'alta';
  else if (total <= -1) priority = 'baixa';

  const reason = signals.length > 0
    ? `Baseado em: ${signals.map(s => s.label).join(', ')}.`
    : 'Sem sinais específicos; prioridade padrão recomendada.';

  return { priority, reason };
}

// ---- Demandas similares (Jaccard sobre tokens) ----
export function findSimilar(d: Demand, all: Demand[], limit = 5): Demand[] {
  const target = new Set(tokenize(`${d.title} ${d.description || ''} ${d.category} ${d.municipality}`));
  if (target.size === 0) return [];

  const scored = all
    .filter(x => x.id !== d.id)
    .map(x => {
      const set = new Set(tokenize(`${x.title} ${x.description || ''} ${x.category} ${x.municipality}`));
      const inter = [...target].filter(t => set.has(t)).length;
      const union = new Set([...target, ...set]).size;
      const score = union > 0 ? inter / union : 0;
      return { x, score };
    })
    .filter(s => s.score > 0.05)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.x);
}

// ---- Busca inteligente em linguagem natural ----
export interface NLSpec {
  search: string;
  status?: string;
  priority?: string;
  uf?: string;
  minValue?: number;
  maxValue?: number;
  overdueOnly?: boolean;
  explanation: string;
}

const UF_LIST = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

/** UFs cuja sigla é palavra comum em português (evita falso positivo). */
const UF_WORDS_BLACKLIST = new Set(['SE']);

/** Palavras-chave por categoria — consumidas da consulta (com plurais). */
const STATUS_KEYWORDS = [
  'pendente', 'pendentes', 'aberta', 'abertas', 'aberto', 'abertos', 'aguardando',
  'analise', 'andamento', 'curso',
  'concluida', 'concluidas', 'concluido', 'concluidos', 'finalizada', 'finalizadas', 'pronta', 'prontas',
  'rejeitada', 'rejeitadas', 'rejeitado', 'rejeitados', 'negada', 'negadas',
];

const PRIORITY_KEYWORDS = [
  'urgente', 'urgentes', 'critica', 'criticas', 'emergencia',
  'alta', 'altas', 'media', 'baixa', 'baixas',
];

/** Termos numéricos/frases de valor — consumidos da consulta. */
const VALUE_KEYWORDS = [
  'milhao', 'milhoes', 'mil', 'reais', 'real', 'mais', 'acima', 'abaixo',
  'menor', 'maior', 'superior', 'ate', 'valor', 'valores', 'r$',
];

/** Nomes de estados (precedidos por "estado de/do/da") — evita "para" (preposição). */
const STATE_NAMES: [RegExp, string][] = [
  [/\bestado\s+(?:de|da|do)?\s*(?:distrito federal)\b/, 'DF'],
  [/\bestado\s+(?:de|da|do)?\s*(?:mato grosso do sul)\b/, 'MS'],
  [/\bestado\s+(?:de|da|do)?\s*(?:mato grosso)\b/, 'MT'],
  [/\bestado\s+(?:de|da|do)?\s*(?:minas gerais)\b/, 'MG'],
  [/\bestado\s+(?:de|da|do)?\s*(?:espirito santo)\b/, 'ES'],
  [/\bestado\s+(?:de|da|do)?\s*(?:rio grande do norte)\b/, 'RN'],
  [/\bestado\s+(?:de|da|do)?\s*(?:rio grande do sul)\b/, 'RS'],
  [/\bestado\s+(?:de|da|do)?\s*(?:santa catarina)\b/, 'SC'],
  [/\bestado\s+(?:de|da|do)?\s*(?:sao paulo)\b/, 'SP'],
  [/\bestado\s+(?:de|da|do)?\s*(?:rio de janeiro)\b/, 'RJ'],
  [/\bestado\s+(?:de|da|do)?\s*(?:paraiba)\b/, 'PB'],
  [/\bestado\s+(?:de|da|do)?\s*(?:alagoas)\b/, 'AL'],
  [/\bestado\s+(?:de|da|do)?\s*(?:amapa)\b/, 'AP'],
  [/\bestado\s+(?:de|da|do)?\s*(?:amazonas)\b/, 'AM'],
  [/\bestado\s+(?:de|da|do)?\s*(?:bahia)\b/, 'BA'],
  [/\bestado\s+(?:de|da|do)?\s*(?:ceara)\b/, 'CE'],
  [/\bestado\s+(?:de|da|do)?\s*(?:goias)\b/, 'GO'],
  [/\bestado\s+(?:de|da|do)?\s*(?:maranhao)\b/, 'MA'],
  [/\bestado\s+(?:de|da|do)?\s*(?:parana)\b/, 'PR'],
  [/\bestado\s+(?:de|da|do)?\s*(?:pernambuco)\b/, 'PE'],
  [/\bestado\s+(?:de|da|do)?\s*(?:piaui)\b/, 'PI'],
  [/\bestado\s+(?:de|da|do)?\s*(?:sergipe)\b/, 'SE'],
  [/\bestado\s+(?:de|da|do)?\s*(?:tocantins)\b/, 'TO'],
  [/\bestado\s+(?:de|da|do)?\s*(?:rondonia)\b/, 'RO'],
  [/\bestado\s+(?:de|da|do)?\s*(?:roraima)\b/, 'RR'],
  [/\bestado\s+(?:de|da|do)?\s*(?:acre)\b/, 'AC'],
];

/** Normalização para análise: minúsculas, sem acentos, espaços colapsados. */
const normQuery = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/** Número no formato brasileiro: "1,5", "1.5", "1.000.000". */
const parseBrNumber = (s: string): number => {
  const t = s.replace(/\s/g, '');
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  const dots = (t.match(/\./g) || []).length;
  if (dots === 1 && /\.\d{1,2}$/.test(t)) return Number(t);
  return Number(t.replace(/\./g, ''));
};

export function parseNaturalLanguage(query: string): NLSpec {
  const q = normQuery(query);
  const spec: NLSpec = { search: '', explanation: 'Mostrando todas as demandas.' };
  const notes: string[] = [];

  // Situação
  const statusRules: [RegExp, string][] = [
    [/\b(?:pendente|pendentes|aberta|abertas|aberto|abertos|aguardando)\b/, 'pendente'],
    [/\b(?:em\s+andamento|em\s+analise|andamento|analise|curso)\b/, 'analise'],
    [/\b(?:concluida|concluidas|concluido|concluidos|finalizada|finalizadas|pronta|prontas)\b/, 'concluido'],
    [/\b(?:rejeitada|rejeitadas|rejeitado|rejeitados|negada|negadas)\b/, 'rejeitado'],
  ];
  for (const [re, st] of statusRules) {
    if (re.test(q)) { spec.status = st; notes.push(`situação "${st}"`); break; }
  }

  // Prioridade
  const priorityRules: [RegExp, string][] = [
    [/\b(?:urgente|urgentes|critica|criticas|emergencia)\b/, 'urgente'],
    [/\b(?:alta|altas)\b/, 'alta'],
    [/\b(?:media)\b/, 'media'],
    [/\b(?:baixa|baixas)\b/, 'baixa'],
  ];
  for (const [re, pr] of priorityRules) {
    if (re.test(q)) { spec.priority = pr; notes.push(`prioridade "${pr}"`); break; }
  }

  // UF por sigla (2 letras) ou nome do estado
  const qUp = q.toUpperCase();
  const siglaMatch = qUp.match(new RegExp(`\\b(${UF_LIST.filter(u => !UF_WORDS_BLACKLIST.has(u)).join('|')})\\b`));
  if (siglaMatch) {
    spec.uf = siglaMatch[1];
    notes.push(`UF "${siglaMatch[1]}"`);
  } else {
    for (const [re, uf] of STATE_NAMES) {
      if (re.test(q)) { spec.uf = uf; notes.push(`UF "${uf}"`); break; }
    }
  }

  // Somente atrasadas
  if (/\b(?:atrasad\w*|vencid\w*|fora do prazo)\b/.test(q)) {
    spec.overdueOnly = true;
    notes.push('somente atrasadas');
  }

  // Valor mínimo
  const valueGE = q.match(/(?:mais de|acima de|superior a|maior que|valor\s+(?:maior|acima|superior))\s*r?\$?\s*([\d.,]+)\s*(?:milhao|milhoes|mil|m|k)?/)
    || q.match(/\b(?:acima|mais)\s*de\s*r?\$?\s*([\d.,]+)\s*(?:milhao|milhoes|mil|m|k)?/);
  if (valueGE && valueGE[1]) {
    const unit = (valueGE[2] || '').toLowerCase();
    let val = parseBrNumber(valueGE[1]);
    if (unit.startsWith('milhao') || unit === 'm') val *= 1_000_000;
    else if (unit === 'mil' || unit === 'k') val *= 1_000;
    spec.minValue = val;
    notes.push(`valor > ${val.toLocaleString('pt-BR')}`);
  }

  // Valor máximo
  const valueLE = q.match(/(?:menor que|abaixo de|ate)\s*r?\$?\s*([\d.,]+)\s*(?:milhao|milhoes|mil|m|k)?/);
  if (valueLE && valueLE[1]) {
    const unit = (valueLE[2] || '').toLowerCase();
    let val = parseBrNumber(valueLE[1]);
    if (unit.startsWith('milhao') || unit === 'm') val *= 1_000_000;
    else if (unit === 'mil' || unit === 'k') val *= 1_000;
    spec.maxValue = val;
    notes.push(`valor < ${val.toLocaleString('pt-BR')}`);
  }

  // Termos de pesquisa restantes (remove palavras-chave, números e stopwords)
  const dropWords = new Set<string>([
    ...STOPWORDS,
    'demandas', 'demanda', 'demand', 'mostre', 'mostrar', 'listar', 'encontrar',
    'buscar', 'procure', 'quais', 'todas', 'todos', 'sao',
    ...STATUS_KEYWORDS, ...PRIORITY_KEYWORDS, ...VALUE_KEYWORDS, ...UF_LIST,
  ]);
  const free = q
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !/^\d+$/.test(w) && !dropWords.has(w))
    .join(' ');
  spec.search = free;

  if (notes.length > 0) {
    spec.explanation = `Filtros aplicados: ${notes.join('; ')}${free ? `; termo: "${free}"` : ''}.`;
  }
  return spec;
}

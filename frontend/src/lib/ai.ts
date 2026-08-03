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

const STATUS_MAP: Record<string, string> = {
  pendente: 'pendente', 'pend': 'pendente', 'aberta': 'pendente', 'aberto': 'pendente',
  analise: 'analise', 'andamento': 'analise', 'curso': 'analise',
  concluido: 'concluido', 'concluída': 'concluido', 'finalizada': 'concluido', 'pronta': 'concluido',
  rejeitado: 'rejeitado', 'rejeitada': 'rejeitado', 'negada': 'rejeitado'
};

const PRIORITY_MAP: Record<string, string> = {
  urgente: 'urgente', 'crítica': 'urgente', 'critica': 'urgente',
  alta: 'alta', 'alta prioridade': 'alta',
  media: 'media', 'média': 'media',
  baixa: 'baixa'
};

const UF_LIST = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export function parseNaturalLanguage(query: string): NLSpec {
  const q = query.toLowerCase();
  const spec: NLSpec = { search: '', explanation: 'Mostrando todas as demandas.' };
  const notes: string[] = [];

  // Status
  for (const [kw, st] of Object.entries(STATUS_MAP)) {
    if (new RegExp(`\\b${kw}\\b`).test(q)) { spec.status = st; notes.push(`status "${st}"`); break; }
  }
  // Priority
  for (const [kw, pr] of Object.entries(PRIORITY_MAP)) {
    if (new RegExp(`\\b${kw.replace(/ /g, '\\s')}\\b`).test(q)) { spec.priority = pr; notes.push(`prioridade "${pr}"`); break; }
  }
  // UF
  const ufFound = UF_LIST.find(uf => new RegExp(`\\b${uf}\\b`).test(q) || q.includes(`estado ${uf.toLowerCase()}`));
  if (ufFound) { spec.uf = ufFound; notes.push(`UF "${ufFound}"`); }
  // Overdue
  if (/\b(atrasad|vencid|sla|fora do prazo)\b/.test(q)) { spec.overdueOnly = true; notes.push('somente atrasadas'); }
  // Valor
  const valueMatch = q.match(/mais de\s*r?\$?\s*([\d.]+)\s*(mil|milhão|milhões|m|k)?/)
    || q.match(/acima de\s*r?\$?\s*([\d.]+)\s*(mil|milhão|milhões|m|k)?/)
    || q.match(/valor\s*(maior|acima|superior)\s*r?\$?\s*([\d.]+)\s*(mil|milhão|milhões|m|k)?/);
  if (valueMatch) {
    const num = parseFloat(valueMatch[1].replace('.', ''));
    const unit = valueMatch[2] || '';
    let val = num;
    if (unit.startsWith('mil')) val = num * 1000;
    else if (unit.startsWith('m')) val = num * 1000000;
    spec.minValue = val;
    notes.push(`valor > ${val.toLocaleString('pt-BR')}`);
  }
  const valueMax = q.match(/(menor|abaixo|até)\s*r?\$?\s*([\d.]+)\s*(mil|milhão|milhões|m|k)?/);
  if (valueMax) {
    const num = parseFloat(valueMax[2].replace('.', ''));
    const unit = valueMax[3] || '';
    let val = num;
    if (unit.startsWith('mil')) val = num * 1000;
    else if (unit.startsWith('m')) val = num * 1000000;
    spec.maxValue = val;
    notes.push(`valor < ${val.toLocaleString('pt-BR')}`);
  }

  // Remaining free text (remove recognized keywords) as search
  let free = q
    .replace(/\b(me\s*mostre|mostrar|listar|demandas|demanda|encontrar|buscar|procure|quais|todas|todos|as|os|que|com|de|da|do|em|no|na)\b/g, ' ')
    .replace(new RegExp(Object.keys(STATUS_MAP).join('|'), 'g'), ' ')
    .replace(new RegExp(Object.keys(PRIORITY_MAP).join('|').replace(/ /g, '|'), 'g'), ' ')
    .replace(new RegExp(UF_LIST.join('|'), 'gi'), ' ')
    .replace(/(atrasad|vencid|sla|fora do prazo|mais de|acima de|valor|milhão|milhões|mil|abaixo|menor|até|\$|r\$)/g, ' ')
    .replace(/\d+/g, ' ')
    .trim();
  spec.search = free;

  if (notes.length > 0) {
    spec.explanation = `Filtros aplicados: ${notes.join('; ')}${free ? `; termo: "${free}"` : ''}.`;
  }
  return spec;
}

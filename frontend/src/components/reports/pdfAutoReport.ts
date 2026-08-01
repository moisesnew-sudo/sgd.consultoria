/* ============================================================
   SGD — Motor de Relatórios PDF com Auto-Layout
   ============================================================
   Gera documentos institucionais com layout adaptativo:
   - Orientação automática: A4 retrato; paisagem quando o
     conteúdo das colunas exige mais largura.
   - Larguras de coluna calculadas pelo conteúdo (chars), com
     coluna flexível ("Objeto") absorvendo o espaço restante.
   - Tamanho de fonte reduzido gradativamente antes de criar
     novas páginas (nunca abaixo de um mínimo legível).
   - Paginação inteligente: linhas nunca são divididas entre
     páginas; cabeçalho institucional repetido em todas as
     páginas; rodapé com "Página X de Y", data e site.
   - Zebra striping, cabeçalho destacado, valores alinhados à
     direita, campos curtos centralizados e quebra de texto
     automática (nenhuma informação cortada horizontalmente).
   ============================================================ */

import { Demand } from '../../types';
import { SL, PL, SC, PC, UC, fmt, fc, computeMetrics, genAnalysis, genRecommendations } from './report-utils';
import { LOGO_B64 } from './logoBase64';

export interface ReportFilters {
  search?: string;
  status?: string;
  priority?: string;
  category?: string;
  uf?: string;
  municipality?: string;
  organ?: string;
  proposal_number?: string;
  object?: string;
  responsible?: string;
  ano?: string;
  dateFrom?: string;
  dateTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  valueMin?: string;
  valueMax?: string;
}

export interface PdfReportOptions {
  demands: Demand[];
  filters?: ReportFilters;
  userLabel: string;
  mode?: 'full' | 'compact';
  title?: string;
  fileName?: string;
  /** Abre o PDF em nova aba em vez de baixar */
  open?: boolean;
}

/* ---------- Constantes de layout (mm) ---------- */
const A4_W = 210;
const A4_H = 297;
const MARGIN = 16;
const FOOTER_ZONE = 16;
const MIN_FLEX = 30;
const CHART_GAP = 6;

const PRIMARY: [number, number, number] = [15, 81, 50];
const SECONDARY: [number, number, number] = [25, 135, 84];
const ACCENT: [number, number, number] = [32, 201, 151];
const GOLD: [number, number, number] = [244, 180, 0];
const LIGHT: [number, number, number] = [233, 236, 239];
const TEXT: [number, number, number] = [33, 37, 41];
const TEXT2: [number, number, number] = [73, 80, 87];
const BORDER: [number, number, number] = [206, 212, 218];
const WHITE: [number, number, number] = [255, 255, 255];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ---------- Colunas da tabela ---------- */

type ColType = 'text' | 'flex' | 'currency' | 'date' | 'center' | 'status' | 'priority';

interface Col {
  header: string;
  type: ColType;
  get: (d: Demand) => string;
  min?: number;
  max?: number;
}

function buildColumns(): Col[] {
  return [
    { header: 'Município', type: 'text', min: 18, max: 44, get: d => d.municipality || '—' },
    { header: 'UF', type: 'center', min: 8, max: 9, get: d => d.uf || '—' },
    { header: 'Órgão', type: 'text', min: 15, max: 38, get: d => d.organ || '—' },
    { header: 'Ano', type: 'center', min: 10, max: 10, get: d => (d.ano != null ? String(d.ano) : '—') },
    { header: 'Nº Proposta', type: 'center', min: 15, max: 26, get: d => d.proposal_number || '—' },
    { header: 'Objeto', type: 'flex', min: MIN_FLEX, get: d => d.title || '—' },
    { header: 'Valor', type: 'currency', min: 23, max: 27, get: d => fmt(d.requested_value || 0) },
    { header: 'Status', type: 'status', min: 16, max: 18, get: d => SL[d.status] || d.status },
    { header: 'Prioridade', type: 'priority', min: 14, max: 16, get: d => PL[d.priority] || d.priority },
  ];
}

/* ---------- Cálculo de larguras (auto-layout) ---------- */

const charW = (fontSize: number, mono = false) => (mono ? 0.62 : 0.56) * fontSize * 0.3528;

function pickFontSize(n: number, landscape: boolean): number {
  const base = n > 800 ? 6.2 : n > 400 ? 6.6 : n > 150 ? 7 : 7.4;
  return landscape ? base + 0.2 : base;
}

function computeWidths(cols: Col[], rows: Demand[], usable: number, fontSize: number): number[] | null {
  const cw = charW(fontSize);
  const mono = charW(fontSize, true);
  const naturals = cols.map(c => {
    let maxChars = c.header.length;
    for (const d of rows) {
      const v = c.get(d);
      if (v.length > maxChars) maxChars = v.length;
    }
    let w: number;
    switch (c.type) {
      case 'currency': w = Math.max(22, maxChars * mono + 5); break;
      case 'date': w = Math.max(14, maxChars * mono + 4); break;
      case 'center': w = Math.max(12, maxChars * mono + 5); break;
      case 'status': w = Math.max(15, maxChars * cw + 6); break;
      case 'priority': w = Math.max(14, maxChars * cw + 6); break;
      default: w = maxChars * cw + 5;
    }
    if (c.min != null) w = Math.max(w, c.min);
    if (c.max != null) w = Math.min(w, c.max);
    return w;
  });

  const flexIdx = cols.findIndex(c => c.type === 'flex');
  if (flexIdx < 0) return naturals;

  let flexW = usable - naturals.reduce((s, w, i) => (i === flexIdx ? s : s + w), 0);

  /* Passo de compressão: reduz colunas de texto até o mínimo antes de decidir pela paisagem */
  if (flexW < MIN_FLEX) {
    const shrinkable = cols
      .map((c, i) => (i !== flexIdx && c.type === 'text' && c.min != null && naturals[i] > c.min ? i : -1))
      .filter(i => i >= 0)
      .sort((a, b) => naturals[b] - naturals[a]);
    for (const i of shrinkable) {
      const cut = Math.min(naturals[i] - (cols[i].min as number), MIN_FLEX - flexW);
      naturals[i] -= cut;
      flexW += cut;
      if (flexW >= MIN_FLEX) break;
    }
  }

  if (flexW < MIN_FLEX) return null;

  const widths = [...naturals];
  widths[flexIdx] = flexW;
  return widths;
}

interface Layout {
  orientation: 'portrait' | 'landscape';
  usable: number;
  pageW: number;
  pageH: number;
  fontSize: number;
  widths: number[];
}

function computeLayout(cols: Col[], rows: Demand[]): Layout {
  for (const landscape of [false, true]) {
    const pageW = landscape ? A4_H : A4_W;
    const pageH = landscape ? A4_W : A4_H;
    const usable = pageW - MARGIN * 2;
    const fontSize = pickFontSize(rows.length, landscape);
    const widths = computeWidths(cols, rows, usable, fontSize);
    if (widths) {
      return { orientation: landscape ? 'landscape' : 'portrait', usable, pageW, pageH, fontSize, widths };
    }
  }
  /* Último recurso: paisagem com fonte mínima */
  const usable = A4_H - MARGIN * 2;
  return {
    orientation: 'landscape', usable, pageW: A4_H, pageH: A4_W, fontSize: 6,
    widths: computeWidths(cols, rows, usable, 6) || cols.map(() => 22),
  };
}

/* ---------- Filtros ---------- */

const STATUS_LABEL: Record<string, string> = SL;
const PRIORITY_LABEL: Record<string, string> = PL;

function buildFilterLabel(filters?: ReportFilters): string {
  if (!filters) return '';
  const parts: string[] = [];
  const active = (v?: string) => v != null && v !== '' && v !== 'all';
  if (filters.search) parts.push(`Palavra-chave: ${filters.search}`);
  if (active(filters.uf)) parts.push(`UF: ${filters.uf}`);
  if (active(filters.municipality)) parts.push(`Município: ${filters.municipality}`);
  if (active(filters.status)) parts.push(`Situação: ${STATUS_LABEL[filters.status as string] || filters.status}`);
  if (active(filters.priority)) parts.push(`Prioridade: ${PRIORITY_LABEL[filters.priority as string] || filters.priority}`);
  if (active(filters.ano)) parts.push(`Ano: ${filters.ano}`);
  if (active(filters.organ)) parts.push(`Órgão: ${filters.organ}`);
  if (active(filters.proposal_number)) parts.push(`Proposta: ${filters.proposal_number}`);
  if (active(filters.object)) parts.push(`Objeto: ${filters.object}`);
  if (filters.category) parts.push(`Categoria: ${filters.category}`);
  if (filters.responsible) parts.push(`Responsável: ${filters.responsible}`);
  if (filters.dateFrom || filters.dateTo) parts.push(`Cadastro: ${filters.dateFrom || '—'} a ${filters.dateTo || '—'}`);
  if (filters.updatedFrom || filters.updatedTo) parts.push(`Atualização: ${filters.updatedFrom || '—'} a ${filters.updatedTo || '—'}`);
  if (active(filters.valueMin)) parts.push(`Valor mín: ${fmt(Number(filters.valueMin))}`);
  if (active(filters.valueMax)) parts.push(`Valor máx: ${fmt(Number(filters.valueMax))}`);
  return parts.join('  •  ');
}

/* ---------- Desenho de cabeçalho e rodapé ---------- */

interface Ctx {
  doc: any;
  pageW: number;
  pageH: number;
  usable: number;
  contentTop: number;
  dateStr: string;
  timeStr: string;
  shortDate: string;
  userLabel: string;
  totalRecords: number;
  filterLabel: string;
  headerDrawn: Set<number>;
}

/** Desenha o cabeçalho institucional apenas uma vez por página */
function drawPageHeader(c: Ctx): number {
  const page = c.doc.getNumberOfPages() || 1;
  if (c.headerDrawn.has(page)) return 34;
  c.headerDrawn.add(page);
  return drawHeader(c);
}

function drawHeader(c: Ctx): number {
  const { doc, pageW } = c;
  const cx = pageW / 2;

  /* Logo proporcional: largura/altura derivadas da resolução original,
     nunca esticada nem comprimida, com altura alvo de 12mm (máx 44mm de largura) */
  let logoW = 44;
  let logoH = 12;
  try {
    const props = doc.getImageProperties(LOGO_B64);
    const ratio = props.width / props.height;
    logoW = logoH * ratio;
    if (logoW > 44) {
      logoW = 44;
      logoH = logoW / ratio;
    }
  } catch {
    /* mantém o padrão 44x12 se não for possível ler as dimensões */
  }

  try {
    doc.addImage(LOGO_B64, 'JPEG', cx - logoW / 2, 4, logoW, logoH);
  } catch {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...PRIMARY);
    doc.text('CGASI.SE', cx, 15, { align: 'center' });
  }

  /* Bloco de textos centralizado, alinhado e com espaçamento da logo */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...PRIMARY);
  doc.text('CGASI.SE — SISTEMA DE GESTÃO DE DEMANDAS', cx, 20.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...TEXT2);
  doc.text(
    'COORDENAÇÃO GERAL DE ARTICULAÇÃO E SUPERVISÃO INSTITUCIONAL DA SECRETARIA EXECUTIVA / MAPA',
    cx, 24, { align: 'center' }
  );

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, 26.2, pageW - MARGIN, 26.2);
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, 27, pageW - MARGIN, 27);

  /* Faixa de metadados: emissão | usuário | registros */
  doc.setFontSize(6.4);
  doc.setTextColor(...TEXT2);
  doc.setFont('helvetica', 'normal');
  doc.text(`Emissão: ${c.shortDate} às ${c.timeStr}`, MARGIN, 31);
  doc.setFont('helvetica', 'bold');
  doc.text(`Usuário: ${c.userLabel}`, cx, 31, { align: 'center' });
  doc.text(`Registros: ${c.totalRecords}`, pageW - MARGIN, 31, { align: 'right' });

  let headerH = 34;
  if (c.filterLabel) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6);
    doc.setTextColor(...TEXT2);
    const flines = doc.splitTextToSize(`Filtros: ${c.filterLabel}`, c.usable);
    doc.text(flines, cx, 34.6, { align: 'center' });
    headerH = 34.6 + Math.max(flines.length - 1, 0) * 2.6 + 3.6;
  }
  return headerH;
}

function drawFooter(c: Ctx, pageNum: number, totalPages: number): void {
  const { doc, pageW, pageH } = c;
  const y = pageH - 10.5;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y - 4, pageW - MARGIN, y - 4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...PRIMARY);
  doc.text('CGASI.SE — SGD', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...TEXT2);
  doc.text('www.gruposgd.com.br', MARGIN, y + 3.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT);
  doc.text(`Página ${pageNum} de ${totalPages}`, pageW - MARGIN, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...TEXT2);
  doc.text(`Emitido em ${c.shortDate} às ${c.timeStr}`, pageW - MARGIN, y + 3.8, { align: 'right' });
}

/* ---------- Primitivas visuais ---------- */

function sectionTitle(c: Ctx, title: string, icon?: string): void {
  const { doc } = c;
  const x = MARGIN;
  if (icon) {
    doc.setFillColor(...PRIMARY);
    doc.roundedRect(x, doc.getY() + 0.3, 4, 5, 0.8, 0.8, 'F');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...PRIMARY);
  doc.text(title, x + (icon ? 7 : 0), doc.getY() + 5);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, doc.getY() + 7, MARGIN + 34, doc.getY() + 7);
  doc.setY(doc.getY() + 11);
}

function infoBox(c: Ctx, items: [string, string][], cols = 4): number {
  const { doc, pageW } = c;
  const usable = pageW - MARGIN * 2;
  const rows = Math.ceil(items.length / cols);
  const cellH = 10;
  const colW = usable / cols;
  const boxH = rows * cellH + 4;
  const y0 = doc.getY();

  doc.setFillColor(...LIGHT);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(MARGIN, y0, usable, boxH, 2, 2, 'FD');
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.8);
  doc.line(MARGIN, y0, MARGIN, y0 + boxH);

  items.forEach(([label, value], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * colW + 5;
    const y = y0 + 4 + row * cellH;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.4);
    doc.setTextColor(...TEXT2);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT);
    doc.text(value, x, y + 4);
  });

  doc.setY(y0 + boxH + 4);
  return boxH;
}

function ensureSpace(c: Ctx, h: number): void {
  const { doc, pageH } = c;
  const remaining = pageH - doc.getY() - FOOTER_ZONE - 4;
  if (remaining < h) {
    doc.addPage();
    drawPageHeader(c);
    doc.setY(c.contentTop);
  }
}

function kpiCards(c: Ctx, items: { label: string; value: string; color: [number, number, number] }[]): void {
  const { doc, pageW } = c;
  const usable = pageW - MARGIN * 2;
  const gap = 3;
  const cols = 3;
  const cardW = (usable - gap * (cols - 1)) / cols;
  const cardH = 13;
  ensureSpace(c, (Math.ceil(items.length / cols)) * (cardH + gap) + 4);
  const y0 = doc.getY();
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cardW + gap);
    const y = y0 + row * (cardH + gap);
    doc.setFillColor(...LIGHT);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
    doc.setDrawColor(...item.color);
    doc.setLineWidth(1.8);
    doc.line(x, y, x, y + cardH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.2);
    doc.setTextColor(...TEXT2);
    doc.text(item.label.toUpperCase(), x + 3.5, y + 3.8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT);
    doc.text(item.value, x + 3.5, y + 9.5);
  });
  doc.setY(y0 + Math.ceil(items.length / cols) * (cardH + gap));
}

function statusBars(c: Ctx, data: { label: string; count: number; value: number; color: string }[]): void {
  const { doc, pageW } = c;
  const usable = pageW - MARGIN * 2;
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const rowH = 5.2;
  ensureSpace(c, data.length * rowH + 6);
  const y0 = doc.getY();
  data.forEach((d, i) => {
    const y = y0 + i * rowH;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(...TEXT2);
    doc.text(d.label, MARGIN, y + 2.6);

    const barX = MARGIN + 24;
    const barW = usable - 24 - 52;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(barX, y + 0.6, barW, 2.6, 1.2, 1.2, 'F');
    doc.setFillColor(...hexToRgb(d.color));
    const w = Math.max((d.count / maxCount) * barW, d.count > 0 ? 2 : 0);
    doc.roundedRect(barX, y + 0.6, w, 2.6, 1.2, 1.2, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(...TEXT);
    doc.text(`${d.count}  •  ${fc(d.value)}`, barX + barW + 4, y + 2.6);
  });
  doc.setY(y0 + data.length * rowH + 2);
}

function donut(c: Ctx, cx: number, cy: number, r: number, ri: number, data: { name: string; value: number; color: string }[]): void {
  const { doc } = c;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return;
  const ctx = doc.canvas.getContext('2d');
  let start = -Math.PI / 2;
  for (const d of data) {
    if (d.value <= 0) continue;
    const sweep = (d.value / total) * Math.PI * 2;
    const end = start + sweep;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end, false);
    ctx.closePath();
    ctx.fill();
    start = end;
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, ri, 0, Math.PI * 2, false);
  ctx.closePath();
  ctx.fill();
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.circle(cx, cy, r, 'S');
}

function legend(c: Ctx, x: number, y: number, maxW: number, items: { name: string; value: number; color: string }[]): void {
  const { doc } = c;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  let curX = x;
  let curY = y;
  for (const item of items) {
    const label = `${item.name} (${item.value})`;
    const w = doc.getTextWidth(label) + 4.5;
    if (curX + w > x + maxW && curX > x) {
      curX = x;
      curY += 3.6;
    }
    doc.setFillColor(...hexToRgb(item.color));
    doc.rect(curX, curY - 1.2, 2.2, 2.2, 'F');
    doc.setTextColor(...TEXT2);
    doc.text(label, curX + 3, curY);
    curX += w + 3;
  }
  doc.setY(Math.max(doc.getY(), curY + 3));
}

function hBars(c: Ctx, title: string, items: { name: string; value: number }[], maxItems = 8): number {
  const { doc, pageW } = c;
  const usable = pageW - MARGIN * 2;
  const list = items.slice(0, maxItems);
  if (list.length === 0) return 0;
  const maxVal = Math.max(...list.map(i => i.value), 1);
  const rowH = 5.6;
  const boxH = list.length * rowH + 12;
  ensureSpace(c, boxH);
  const y0 = doc.getY();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT2);
  doc.text(title.toUpperCase(), MARGIN, y0);
  const labelW = Math.min(46, usable * 0.3);
  const valW = 28;
  const barW = usable - labelW - valW;
  list.forEach((item, i) => {
    const y = y0 + 8 + i * rowH;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.6);
    doc.setTextColor(...TEXT2);
    const name = item.name.length > 26 ? item.name.slice(0, 25) + '…' : item.name;
    doc.text(name, MARGIN, y + 1.8, { maxWidth: labelW - 2 });
    doc.setFillColor(...LIGHT);
    doc.rect(MARGIN + labelW, y, barW, 2.4, 'F');
    doc.setFillColor(...PRIMARY);
    doc.rect(MARGIN + labelW, y, Math.max((item.value / maxVal) * barW, item.value > 0 ? 1.2 : 0), 2.4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.6);
    doc.setTextColor(...TEXT);
    doc.text(fc(item.value), MARGIN + labelW + barW + 1.5, y + 1.8);
  });
  doc.setY(y0 + boxH + CHART_GAP);
  return boxH + CHART_GAP;
}

function vBars(c: Ctx, title: string, items: { name: string; value: number }[]): number {
  const { doc, pageW } = c;
  const usable = pageW - MARGIN * 2;
  if (items.length === 0) return 0;
  const maxVal = Math.max(...items.map(i => i.value), 1);
  const chartH = Math.min(32, 22 + usable * 0.03);
  const boxH = chartH + 16;
  ensureSpace(c, boxH);
  const y0 = doc.getY();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT2);
  doc.text(title.toUpperCase(), MARGIN, y0);
  const chartY = y0 + 5;
  const gap = 3;
  const barW = Math.min(14, (usable - gap * (items.length - 1)) / items.length);
  const totalW = items.length * barW + gap * (items.length - 1);
  const startX = MARGIN + (usable - totalW) / 2;
  items.forEach((item, i) => {
    const x = startX + i * (barW + gap);
    const h = Math.max((item.value / maxVal) * chartH, item.value > 0 ? 1.5 : 0);
    doc.setFillColor(...hexToRgb(UC[i % UC.length]));
    doc.rect(x, chartY + chartH - h, barW, h, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.8);
    doc.setTextColor(...TEXT2);
    doc.text(item.name, x + barW / 2, chartY + chartH + 3, { align: 'center' });
    doc.setTextColor(...TEXT);
    doc.text(fc(item.value), x + barW / 2, chartY + chartH - h - 1.2, { align: 'center' });
  });
  doc.setY(y0 + boxH + CHART_GAP);
  return boxH + CHART_GAP;
}

/* ---------- Bloco de gráficos com área reservada e auto-layout ---------- */

/**
 * Donuts em grade (2 colunas) quando a largura permite; caso contrário,
 * empilhados verticalmente. O raio é dimensionado conforme a largura útil
 * da página (retrato/paisagem) e a área é reservada antes da renderização.
 */
function drawDonuts(
  c: Ctx,
  left: { name: string; value: number; color: string }[],
  right: { name: string; value: number; color: string }[],
  leftTitle: string,
  rightTitle: string,
): void {
  const { doc } = c;
  const sideBySide = c.usable >= 165;
  const r = Math.min(18, Math.max(13, c.usable * 0.09));
  const blockH = Math.ceil(2 * r + 20);
  const totalH = sideBySide ? blockH : blockH * 2 + CHART_GAP;
  ensureSpace(c, totalH);
  const y0 = doc.getY();
  const donutW = sideBySide ? (c.usable - 8) / 2 : c.usable;
  const leftCx = MARGIN + donutW / 2;
  const rightCx = MARGIN + donutW + 8 + donutW / 2;

  const drawRow = (rowTop: number, which: 'left' | 'right'): void => {
    const centerX = sideBySide ? (which === 'left' ? leftCx : rightCx) : MARGIN + donutW / 2;
    const centerY = rowTop + 6 + r + 1.5;
    const data = which === 'left' ? left : right;
    const title = which === 'left' ? leftTitle : rightTitle;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT2);
    doc.text(title, centerX, rowTop + 5, { align: 'center' });
    donut(c, centerX, centerY, r, r * 0.57, data);
    legend(c, MARGIN + (which === 'right' && sideBySide ? donutW + 8 : 0), centerY + r + 4, donutW - 2, data);
  };

  drawRow(y0, 'left');
  if (sideBySide) drawRow(y0, 'right');
  else drawRow(y0 + blockH + CHART_GAP, 'right');
  doc.setY(y0 + totalH + CHART_GAP);
}

/** Renderiza a seção "Análise Gráfica": cada gráfico ocupa apenas sua área */
function drawChartsSection(
  c: Ctx,
  statusPie: { name: string; value: number; color: string }[],
  priorityPie: { name: string; value: number; color: string }[],
  yearBars: { name: string; value: number }[],
  topMun: { name: string; value: number }[],
): void {
  drawDonuts(c, statusPie, priorityPie, 'DISTRIBUIÇÃO POR STATUS', 'DISTRIBUIÇÃO POR PRIORIDADE');
  vBars(c, 'Evolução por Ano', yearBars);
  hBars(c, 'Top 10 — Valor por Município', topMun);
}

/* ---------- Builder principal ---------- */

export async function buildPdfReport(opts: PdfReportOptions): Promise<any> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = (autoTableMod as any).default || autoTableMod;
  const mode = opts.mode || 'compact';

  const rows = [...opts.demands]
    .map(d => ({
      ...d,
      title: String(d.title ?? '').toUpperCase(),
      description: String(d.description ?? '').toUpperCase(),
      category: String(d.category ?? '').toUpperCase(),
      municipality: String(d.municipality ?? '').toUpperCase(),
      prefeitura: String(d.prefeitura ?? '').toUpperCase(),
      organ: String(d.organ ?? '').toUpperCase(),
      proposal_number: String(d.proposal_number ?? '').toUpperCase(),
      responsible_name: String(d.responsible_name ?? '').toUpperCase(),
      notes: String(d.notes ?? '').toUpperCase(),
      uf: String(d.uf ?? '').toUpperCase(),
    }))
    .sort((a, b) => {
      const cmp = a.municipality.localeCompare(b.municipality, 'pt-BR', { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const cols = buildColumns();
  const layout = computeLayout(cols, rows);
  const doc: any = new jsPDF({ orientation: layout.orientation, unit: 'mm', format: 'a4' });

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const shortDate = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const m = computeMetrics(rows);
  const filterLabel = buildFilterLabel(opts.filters);
  const title = opts.title || (mode === 'full' ? 'RELATÓRIO EXECUTIVO DE DEMANDAS' : 'RELATÓRIO DE DEMANDAS');

  /* jsPDF v4 não expõe getY/setY: injeta-se um cursor próprio */
  let cursor = 0;
  doc.getY = () => cursor;
  doc.setY = (v: number) => { cursor = v; };

  const c: Ctx = {
    doc, pageW: layout.pageW, pageH: layout.pageH, usable: layout.usable,
    contentTop: 0,
    dateStr, timeStr, shortDate,
    userLabel: opts.userLabel || '—',
    totalRecords: rows.length,
    filterLabel,
    headerDrawn: new Set<number>(),
  };

  const headerH = drawPageHeader(c);
  c.contentTop = headerH + 3;
  doc.setY(c.contentTop);

  /* Título centralizado */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(...PRIMARY);
  doc.text(title, layout.pageW / 2, doc.getY() + 4, { align: 'center' });
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  const titleHalf = Math.min(50, doc.getTextWidth(title) / 2 + 8);
  doc.line(layout.pageW / 2 - titleHalf, doc.getY() + 5.6, layout.pageW / 2 + titleHalf, doc.getY() + 5.6);
  doc.setY(doc.getY() + 10);

  /* Faixa de informações institucionais */
  const yearRange = m.byYear.length > 1 ? `${m.byYear[0].year} — ${m.byYear[m.byYear.length - 1].year}` : m.byYear.length === 1 ? m.byYear[0].year : '—';
  infoBox(c, [
    ['Emissão', `${shortDate} às ${timeStr}`],
    ['Usuário responsável', c.userLabel],
    ['Total de registros', String(rows.length)],
    ['Valor global solicitado', fmt(m.totalValue)],
    ['Municípios', String(m.municipalities)],
    ['Estados', String(m.states)],
    ['Órgãos demandantes', String(m.organs)],
    ['Período', yearRange],
  ]);

  if (mode === 'full' && rows.length > 0) {
    /* Indicadores gerenciais */
    sectionTitle(c, 'Indicadores Gerenciais');
    kpiCards(c, [
      { label: 'Total de Demandas', value: String(m.total), color: PRIMARY },
      { label: 'Valor Solicitado', value: fmt(m.totalValue), color: SECONDARY },
      { label: 'Em Análise', value: String(m.byStatus.analise || 0), color: ACCENT },
      { label: 'Concluídas', value: String(m.byStatus.concluido || 0), color: GOLD },
      { label: 'Rejeitadas', value: String(m.byStatus.rejeitado || 0), color: hexToRgb('#dc3545') },
      { label: 'Taxa de Aprovação', value: `${m.approvalRate}%`, color: PRIMARY },
    ]);
    statusBars(c, (['pendente', 'analise', 'concluido', 'rejeitado'] as const).map(st => ({
      label: SL[st],
      count: m.byStatus[st] || 0,
      value: rows.filter(d => d.status === st).reduce((s, d) => s + (d.requested_value || 0), 0),
      color: SC[st],
    })));

    /* Análise executiva */
    sectionTitle(c, 'Análise Executiva');
    ensureSpace(c, 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT2);
    doc.setLineHeightFactor(1.35);
    const paragraphs = genAnalysis(m);
    for (const p of paragraphs) {
      const lines = doc.splitTextToSize(p, c.usable);
      ensureSpace(c, lines.length * 3.4 + 5);
      doc.text(lines, MARGIN, doc.getY() + 3);
      doc.setY(doc.getY() + lines.length * 3.4 + 2.4);
    }

    /* Gráficos com auto-layout: área exclusiva, grid/stack e sem sobreposição */
    sectionTitle(c, 'Análise Gráfica');
    const statusPie = (Object.entries(m.byStatus) as [string, number][]).map(([k, v]) => ({ name: SL[k] || k, value: v, color: SC[k] }));
    const priorityPie = (Object.entries(m.byPriority) as [string, number][]).map(([k, v]) => ({ name: PL[k] || k, value: v, color: PC[k] }));
    const topMun = Object.entries(m.byMun).map(([k, v]) => ({ name: k, value: v.value })).sort((a, b) => b.value - a.value).slice(0, 10);
    drawChartsSection(c, statusPie, priorityPie, m.byYear.map(y => ({ name: y.year, value: y.count })), topMun);

    /* Recomendações */
    sectionTitle(c, 'Recomendações Estratégicas');
    const recs = genRecommendations(m);
    ensureSpace(c, recs.length * 7 + 8);
    recs.forEach((r, i) => {
      const lines = doc.splitTextToSize(r, c.usable - 10);
      ensureSpace(c, lines.length * 3.1 + 4);
      const cy = doc.getY() + 3;
      doc.setFillColor(...ACCENT);
      doc.circle(MARGIN + 2.4, cy - 1, 2.4, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      doc.setTextColor(...WHITE);
      doc.text(String(i + 1), MARGIN + 2.4, cy + 0.2, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...TEXT2);
      doc.setLineHeightFactor(1.3);
      doc.text(lines, MARGIN + 7, cy);
      doc.setY(cy + lines.length * 3.1 + 1.6);
    });
  }

  /* Tabela executiva com auto-layout */
  const tableTitle = mode === 'full' ? 'Tabela Executiva de Demandas' : 'Demandas Filtradas';
  ensureSpace(c, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...PRIMARY);
  doc.text(tableTitle, MARGIN, doc.getY() + 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(...TEXT2);
  doc.text(
    `${rows.length} demanda(s)  •  ${m.municipalities} município(s)  •  ${m.states} estado(s)  •  Valor global ${fmt(m.totalValue)}`,
    MARGIN, doc.getY() + 6.4
  );
  doc.setY(doc.getY() + 10);

  if (rows.length > 0) {
    autoTable(doc, {
      startY: doc.getY(),
      head: [cols.map(c => c.header)],
      body: rows.map(d => cols.map(c => c.get(d))),
      theme: 'grid',
      margin: { left: MARGIN, right: MARGIN, top: headerH + 1, bottom: FOOTER_ZONE + 2 },
      styles: {
        font: 'helvetica',
        fontSize: layout.fontSize,
        cellPadding: 2.2,
        lineColor: BORDER,
        lineWidth: 0.25,
        textColor: TEXT,
        valign: 'middle',
        overflow: 'linebreak',
        minCellHeight: 4.8,
      },
      headStyles: {
        fillColor: PRIMARY,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: Math.min(7.2, layout.fontSize + 0.4),
        halign: 'center',
        cellPadding: 2.6,
      },
      alternateRowStyles: { fillColor: [243, 245, 244] },
      columnStyles: Object.fromEntries(
        layout.widths.map((w, i) => [
          i,
          {
            cellWidth: w,
            halign: cols[i].type === 'currency' ? 'right' : cols[i].type === 'center' || cols[i].type === 'status' || cols[i].type === 'priority' ? 'center' : 'left',
            fontStyle: cols[i].type === 'currency' ? 'bold' : 'normal',
          },
        ])
      ),
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      didDrawPage: () => {
        drawPageHeader(c);
      },
      didParseCell: (data: any) => {
        if (data.section === 'body') {
          const d = rows[data.row.index];
          if (!d) return;
          if (cols[data.column.index].type === 'status') data.cell.styles.textColor = hexToRgb(SC[d.status] || '#495057');
          if (cols[data.column.index].type === 'priority') data.cell.styles.textColor = hexToRgb(PC[d.priority] || '#495057');
        }
      },
    });
  } else {
    ensureSpace(c, 24);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT2);
    doc.text('Nenhuma demanda encontrada para os filtros selecionados.', layout.pageW / 2, doc.getY() + 8, { align: 'center' });
  }

  /* Rodapé com numeração correta em todas as páginas */
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(c, i, totalPages);
  }

  const baseName = (opts.fileName || `sgd-relatorio-${now.toISOString().slice(0, 10)}`).replace(/\.pdf$/i, '');
  if (opts.open) {
    const url = doc.output('bloburl');
    window.open(url, '_blank');
  } else {
    doc.save(`${baseName}.pdf`);
  }

  return doc;
}

import { Demand } from '../../types';
import { computeMetrics, genAnalysis, genRecommendations, RM, fmt, fc, fd, SL, PL, SC, PC, UC } from './report-utils';

/* ============================================================
   SVG Chart Generators
   ============================================================ */

function donutChart(data: { name: string; value: number; color: string }[], cx: number, cy: number, r: number, ri: number): string {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return '';
  let startAngle = 0;
  const segments: string[] = [];
  for (const d of data) {
    const sweep = (d.value / total) * 360;
    const endAngle = startAngle + sweep;
    const sr = ((startAngle - 90) * Math.PI) / 180;
    const er = ((endAngle - 90) * Math.PI) / 180;
    const ox1 = cx + r * Math.cos(sr);
    const oy1 = cy + r * Math.sin(sr);
    const ox2 = cx + r * Math.cos(er);
    const oy2 = cy + r * Math.sin(er);
    const ix1 = cx + ri * Math.cos(er);
    const iy1 = cy + ri * Math.sin(er);
    const ix2 = cx + ri * Math.cos(sr);
    const iy2 = cy + ri * Math.sin(sr);
    const la = sweep > 180 ? 1 : 0;
    const path = `M${ox1.toFixed(1)} ${oy1.toFixed(1)} A${r} ${r} 0 ${la} 1 ${ox2.toFixed(1)} ${oy2.toFixed(1)} L${ix1.toFixed(1)} ${iy1.toFixed(1)} A${ri} ${ri} 0 ${la} 0 ${ix2.toFixed(1)} ${iy2.toFixed(1)} Z`;
    segments.push(`<path d="${path}" fill="${d.color}" stroke="#fff" stroke-width="1.5"/>`);
    startAngle = endAngle;
  }
  return segments.join('\n');
}

function barChart(data: { name: string; value: number }[], width: number, height: number, formatter: (v: number) => string): string {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barH = Math.max(18, Math.min(26, (height - 40) / data.length));
  const labelW = 140;
  const chartW = width - labelW - 50;
  const topPad = 8;
  let svg = '';
  data.forEach((d, i) => {
    const bw = (d.value / maxVal) * chartW;
    const y = topPad + i * barH;
    svg += `<text x="${labelW - 6}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="9" fill="#64748b" font-family="monospace">${d.name}</text>`;
    svg += `<rect x="${labelW}" y="${y + 2}" width="${Math.max(bw, 2)}" height="${barH - 4}" rx="3" fill="#3b5bdb"/>`;
    svg += `<text x="${labelW + bw + 6}" y="${y + barH / 2 + 4}" font-size="9" fill="#475569" font-family="monospace">${formatter(d.value)}</text>`;
  });
  return svg;
}

function lineChart(data: { year: string; count: number }[], width: number, height: number): string {
  if (data.length === 0) return '';
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const pad = { top: 10, right: 10, bottom: 24, left: 35 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;
  const minYear = parseInt(data[0].year);
  const maxYear = parseInt(data[data.length - 1].year);
  const yearRange = maxYear - minYear || 1;
  let grid = '';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = pad.top + ch - (i / steps) * ch;
    const val = Math.round((i / steps) * maxCount);
    grid += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
    grid += `<text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="#94a3b8">${val}</text>`;
  }
  let points: { x: number; y: number }[] = [];
  data.forEach(d => {
    const x = pad.left + ((parseInt(d.year) - minYear) / yearRange) * cw;
    const y2 = pad.top + ch - (d.count / maxCount) * ch;
    points.push({ x, y: y2 });
  });
  let lineD = '';
  points.forEach((p, i) => {
    lineD += (i === 0 ? `M${p.x.toFixed(1)} ${p.y.toFixed(1)}` : ` L${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  });
  let dots = '';
  points.forEach(p => {
    dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#3b5bdb" stroke="#fff" stroke-width="1.5"/>`;
  });
  let labels = '';
  data.forEach(d => {
    const x = pad.left + ((parseInt(d.year) - minYear) / yearRange) * cw;
    labels += `<text x="${x}" y="${height - 5}" text-anchor="middle" font-size="9" fill="#64748b">${d.year}</text>`;
  });
  return `${grid}<path d="${lineD}" fill="none" stroke="#3b5bdb" stroke-width="2.5"/>${dots}${labels}`;
}

function legendHtml(items: { name: string; value: number; color: string }[]): string {
  return items.map(d => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#64748b"><span style="width:8px;height:8px;border-radius:50%;background:${d.color}"></span>${d.name}: <strong>${d.value}</strong></span>`).join('');
}

/* ============================================================
   Page Header (pages 2+) & Footer
   ============================================================ */

function pageHeader(page: number, total: number, date: string): string {
  return `<div class="phdr"><div class="phdr-l"><div class="phdr-logo">SGD</div><span class="phdr-txt">Sistema de Gestão de Demandas — Relatório Executivo</span></div><span class="phdr-num">${date} | Página ${page} de ${total}</span></div>`;
}

function pageFooter(): string {
  return '<div class="pftr"><span>Documento Confidencial</span><span>Sistema de Gestão de Demandas</span></div>';
}

function sectionTitle(title: string, color: string, iconSvg: string): string {
  return `<div class="sectit"><span class="sectit-icon">${iconSvg}</span><h2 style="color:${color}">${title}</h2></div>`;
}

/* ============================================================
   Main HTML Builder
   ============================================================ */

export function buildReportHtml(demands: Demand[], filters: { uf: string; status: string; priority: string; ano: string }, userLabel: string): string {
  const m = computeMetrics(demands);
  const analysis = genAnalysis(m);
  const recs = genRecommendations(m);

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const shortDate = now.toLocaleDateString('pt-BR');

  const fp: string[] = [];
  if (filters.uf) fp.push(`UF: ${filters.uf}`);
  if (filters.status) fp.push(`Status: ${SL[filters.status] || filters.status}`);
  if (filters.priority) fp.push(`Prioridade: ${PL[filters.priority] || filters.priority}`);
  if (filters.ano) fp.push(`Ano: ${filters.ano}`);
  const filterLabel = fp.length > 0 ? fp.join(' | ') : 'Sem filtros';

  const totalPages = 6;

  /* Chart data */
  const statusPie = Object.entries(m.byStatus).map(([k, v]) => ({ name: SL[k] || k, value: v, color: SC[k] }));
  const priorityPie = Object.entries(m.byPriority).map(([k, v]) => ({ name: PL[k] || k, value: v, color: PC[k] }));
  const ufPie = Object.entries(m.byUf).map(([k, v], i) => ({ name: k, value: v, color: UC[i % UC.length] }));
  const topMunBar = Object.entries(m.byMun).map(([k, v]) => ({ name: k.split('/')[0], value: v.value })).sort((a, b) => b.value - a.value).slice(0, 10);

  /* Icons as SVG */
  const iconBrain = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4c0 1.1-.4 2.1-1 2.8V12l-3 2-3-2V8.8c-.6-.7-1-1.7-1-2.8a4 4 0 0 1 4-4z"/><path d="M9 12v6"/><path d="M15 12v6"/></svg>';
  const iconLightbulb = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1.49.45 2.77 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>';
  const iconBarChart = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/></svg>';
  const iconTarget = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=210mm">
<title>Relatório Executivo — SGD</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4 portrait;margin:25mm 20mm 20mm 20mm}
@page:first{margin-top:25mm}
body{font-family:'Inter','Segoe UI',system-ui,sans-serif;font-size:12px;line-height:1.6;color:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* Cover */
.cvr{min-height:297mm;display:flex;flex-direction:column;background:linear-gradient(165deg,#f8faff,#eef2ff 50%,#e8eef8);page-break-after:always}
.cvr-bd{flex:1;padding:25mm 20mm;display:flex;flex-direction:column}
.cvr-lg{display:flex;align-items:center;gap:16px;margin-bottom:64px}
.cvr-lg-i{width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,#6366f1,#3b5bdb);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 15px -3px rgba(0,0,0,.1)}
.cvr-lg-i span{color:#fff;font-weight:900;font-size:24px;letter-spacing:.05em}
.cvr-lg-t p:first-child{font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.2em}
.cvr-lg-t p:last-child{font-size:8px;color:#94a3b8;text-transform:uppercase;margin-top:2px}
.cvr-bdg{font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.25em;background:#eef2ff;padding:6px 12px;border-radius:999px;display:inline-block;width:fit-content;margin-bottom:20px}
.cvr-tit{font-size:32px;font-weight:900;color:#0f172a;line-height:1.1;letter-spacing:-.02em;margin-bottom:12px}
.cvr-sub{font-size:22px;color:#64748b;font-weight:300;margin-bottom:40px}
.cvr-info{border-top:1px solid #eef2ff;padding-top:32px;max-width:420px}
.cvr-info .r{display:flex;justify-content:space-between;margin-bottom:8px}
.cvr-info .l{color:#94a3b8;font-size:12px}
.cvr-info .v{color:#1e293b;font-weight:600;font-size:12px;text-align:right;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cvr-ft{border-top:1px solid rgba(99,102,241,.2);padding:16px 20mm;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8}

/* Pages */
.pg{page-break-after:always;min-height:297mm;display:flex;flex-direction:column}
.pg:last-child{page-break-after:auto}
.pg-bd{flex:1;padding:0 20mm 20mm 20mm}

/* Page Header */
.phdr{display:flex;align-items:center;justify-content:space-between;padding:25mm 20mm 10px 20mm;border-bottom:1px solid #f1f5f9;margin-bottom:20px}
.phdr-l{display:flex;align-items:center;gap:10px}
.phdr-logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#3b5bdb);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:10px;letter-spacing:.05em}
.phdr-txt{font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase}
.phdr-num{font-size:10px;color:#94a3b8;font-family:monospace}

/* Footer */
.pftr{border-top:1px solid #f1f5f9;padding:10px 20mm;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;margin-top:auto}

/* Section Title */
.sectit{display:flex;align-items:center;gap:8px;margin-bottom:20px}
.sectit-icon{display:flex;align-items:center}
.sectit h2{font-size:18px;font-weight:900;margin:0}

/* KPI */
.kpi-g{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
.kpi-c{display:flex;align-items:center;gap:12px;background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:16px}
.kpi-ic{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kpi-l{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
.kpi-v{font-size:15px;font-weight:900;color:#0f172a;margin-top:2px}
.kpi-mg{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.kpi-mc{text-align:center;background:#fff;border:1px solid #f1f5f9;border-radius:12px;padding:12px}
.kpi-ml{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase}
.kpi-mv{font-size:18px;font-weight:900;color:#0f172a;margin-top:4px}
.kpi-mh{font-size:10px;color:#94a3b8;margin-top:2px}

/* Analysis / Text */
.anl{font-size:12px;color:#475569;line-height:1.8}
.anl p{margin-bottom:14px}

/* Insights */
.ins-g{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ins-c{background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:14px}
.ins-l{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
.ins-v{font-size:14px;font-weight:700;color:#0f172a;word-break:break-word}
.ins-d{font-size:10px;color:#64748b;margin-top:2px;word-break:break-word}

/* Charts */
.ch{text-align:center;margin-bottom:24px;page-break-inside:avoid}
.ch-g{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.ch-b{border:1px solid #f1f5f9;border-radius:12px;padding:16px;page-break-inside:avoid}
.ch-t{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;text-align:center;margin-bottom:10px}
.ch-lg{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:8px}

/* Table */
.tb-w{overflow-x:auto}
.tb{width:100%;border-collapse:collapse;font-size:8px;text-align:left;min-width:680px}
.tb thead{display:table-header-group}
.tb th{background:#6366f1;color:#fff;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:8px 6px;white-space:nowrap}
.tb td{padding:6px;border-bottom:1px solid #f1f5f9;white-space:nowrap}
.tb tr:nth-child(even){background:rgba(248,250,252,.6)}
.tb .cid{font-family:monospace;font-weight:700;color:#475569}
.tb .ctit{font-weight:600;color:#0f172a;max-width:160px;overflow:hidden;text-overflow:ellipsis}
.tb .cmun{color:#475569}
.tb .corg{color:#475569;max-width:80px;overflow:hidden;text-overflow:ellipsis}
.tb .cano{font-family:monospace;color:#64748b;text-align:center}
.tb .cval{font-family:monospace;font-weight:700;color:#0f172a;text-align:right;white-space:nowrap}
.tb .cdat{color:#64748b;font-family:monospace;white-space:nowrap}
.tb .cst{display:inline-block;padding:2px 8px;border-radius:4px;font-size:8px;font-weight:700;text-transform:uppercase}
.tb .cpr{font-size:8px;font-weight:700;text-transform:uppercase}

/* Recommendations */
.rec-l{display:flex;flex-direction:column;gap:12px}
.rec-i{display:flex;align-items:flex-start;gap:14px;background:linear-gradient(to right,#ecfdf5,#fff);border:1px solid #d1fae5;border-radius:12px;padding:16px}
.rec-n{width:32px;height:32px;border-radius:50%;background:#059669;color:#fff;font-size:14px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.rec-t{font-size:12px;color:#475569;line-height:1.6;padding-top:2px}
.rec-concl{border-top:1px solid #f1f5f9;padding-top:24px;margin-top:24px;text-align:center;font-size:10px;color:#94a3b8}
.rec-concl .sn{font-weight:600;color:#475569;margin-bottom:4px}

/* Screen button */
.scr-btn{text-align:center;padding:16px}
.scr-btn button{padding:10px 32px;background:linear-gradient(to right,#6366f1,#7c3aed);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer}
@media print{.scr-btn{display:none}}
</style>
</head>
<body>

<div class="scr-btn"><button onclick="window.print()">Imprimir / Exportar PDF</button></div>

<!-- ===== PAGE 1: COVER ===== -->
<div class="cvr">
  <div class="cvr-bd">
    <div class="cvr-lg">
      <div class="cvr-lg-i"><span>SGD</span></div>
      <div class="cvr-lg-t"><p>Sistema de Gestão de Demandas</p><p>Plataforma de Análise e Acompanhamento</p></div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
      <span class="cvr-bdg">Relatório Executivo</span>
      <h1 class="cvr-tit">RELATÓRIO EXECUTIVO</h1>
      <p class="cvr-sub">Análise Inteligente das Demandas</p>
      <div class="cvr-info">
        <div class="r"><span class="l">Data de emissão</span><span class="v">${dateStr}</span></div>
        <div class="r"><span class="l">Horário</span><span class="v">${timeStr}</span></div>
        <div class="r"><span class="l">Usuário</span><span class="v">${userLabel}</span></div>
        <div class="r"><span class="l">Filtros aplicados</span><span class="v">${filterLabel}</span></div>
        <div class="r"><span class="l">Total de demandas</span><span class="v">${m.total}</span></div>
        <div class="r"><span class="l">Municípios envolvidos</span><span class="v">${m.municipalities}</span></div>
        <div class="r"><span class="l">Valor total solicitado</span><span class="v">${fmt(m.totalValue)}</span></div>
        <div class="r"><span class="l">Período</span><span class="v">${m.byYear.length > 0 ? m.byYear[0].year + ' — ' + m.byYear[m.byYear.length - 1].year : '—'}</span></div>
      </div>
    </div>
  </div>
  <div class="cvr-ft">
    <span>Documento Confidencial</span>
    <span>Sistema de Gestão de Demandas</span>
    <span>${shortDate}</span>
  </div>
</div>

<!-- ===== PAGE 2: INDICADORES ===== -->
<div class="pg">
  ${pageHeader(2, totalPages, shortDate)}
  <div class="pg-bd">
    <h2 style="font-size:18px;font-weight:900;color:#0f172a;margin-bottom:20px">Indicadores Gerenciais</h2>
    <div class="kpi-g">
      <div class="kpi-c">
        <div class="kpi-ic" style="background:#eef2ff;color:#6366f1"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
        <div><p class="kpi-l">Total de Demandas</p><p class="kpi-v">${m.total}</p></div>
      </div>
      <div class="kpi-c">
        <div class="kpi-ic" style="background:#eff6ff;color:#3b82f6"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>
        <div><p class="kpi-l">Valor Solicitado</p><p class="kpi-v">${fc(m.totalValue)}</p></div>
      </div>
      <div class="kpi-c">
        <div class="kpi-ic" style="background:#ecfdf5;color:#10b981"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div><p class="kpi-l">Valor Aprovado</p><p class="kpi-v">${fc(m.approvedValue)}</p></div>
      </div>
      <div class="kpi-c">
        <div class="kpi-ic" style="background:#f0fdf4;color:#22c55e"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15H8.5C6.01 15 5 13.48 5 11.5 5 9.52 6.01 8 8.5 8H12"/><path d="M12 8h3.5c2.49 0 3.5 1.52 3.5 3.5s-1.01 3.5-3.5 3.5H12"/><circle cx="12" cy="15" r="2"/><path d="M12 2v2m0 20v-2"/><path d="M22 12h-2M4 12H2"/></svg></div>
        <div><p class="kpi-l">Valor Concluído</p><p class="kpi-v">${fc(m.concludedValue)}</p></div>
      </div>
      <div class="kpi-c">
        <div class="kpi-ic" style="background:#fef2f2;color:#f43f5e"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
        <div><p class="kpi-l">Valor Rejeitado</p><p class="kpi-v">${fc(m.rejectedValue)}</p></div>
      </div>
      <div class="kpi-c">
        <div class="kpi-ic" style="background:#fffbeb;color:#f59e0b"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>
        <div><p class="kpi-l">Taxa de Aprovação</p><p class="kpi-v">${m.approvalRate}%</p></div>
      </div>
    </div>
    <div class="kpi-mg">
      <div class="kpi-mc"><p class="kpi-ml">Municípios</p><p class="kpi-mv">${m.municipalities}</p><p class="kpi-mh">Atendidos</p></div>
      <div class="kpi-mc"><p class="kpi-ml">Estados</p><p class="kpi-mv">${m.states}</p><p class="kpi-mh">Envolvidos</p></div>
      <div class="kpi-mc"><p class="kpi-ml">Órgãos</p><p class="kpi-mv">${m.organs}</p><p class="kpi-mh">Demandantes</p></div>
      <div class="kpi-mc"><p class="kpi-ml">Tempo Médio</p><p class="kpi-mv">${m.avgTime > 0 ? m.avgTime.toFixed(1) + 'd' : '—'}</p><p class="kpi-mh">Até conclusão</p></div>
      <div class="kpi-mc"><p class="kpi-ml">Valor Médio</p><p class="kpi-mv">${fc(m.avgValue)}</p><p class="kpi-mh">Por demanda</p></div>
      <div class="kpi-mc"><p class="kpi-ml">Taxa Conclusão</p><p class="kpi-mv">${m.conclusionRate}%</p><p class="kpi-mh">${m.concludedCount} concluídas</p></div>
    </div>
  </div>
  ${pageFooter()}
</div>

<!-- ===== PAGE 3: ANÁLISE IA ===== -->
<div class="pg">
  ${pageHeader(3, totalPages, shortDate)}
  <div class="pg-bd">
    ${sectionTitle('Análise da IA', '#6366f1', iconBrain)}
    <div class="anl">
      ${analysis.map(p => `<p>${p}</p>`).join('\n')}
    </div>
  </div>
  ${pageFooter()}
</div>

<!-- ===== PAGE 4: GRÁFICOS ===== -->
<div class="pg">
  ${pageHeader(4, totalPages, shortDate)}
  <div class="pg-bd">
    ${sectionTitle('Análise Gráfica', '#6366f1', iconBarChart)}
    <div class="ch-g">
      <div class="ch-b">
        <p class="ch-t">Distribuição por Status</p>
        <svg width="100%" height="200" viewBox="0 0 280 200" style="max-width:280px">
          ${donutChart(statusPie, 140, 100, 80, 45)}
        </svg>
        <div class="ch-lg">${legendHtml(statusPie)}</div>
      </div>
      <div class="ch-b">
        <p class="ch-t">Distribuição por Prioridade</p>
        <svg width="100%" height="200" viewBox="0 0 280 200" style="max-width:280px">
          ${donutChart(priorityPie, 140, 100, 80, 45)}
        </svg>
        <div class="ch-lg">${legendHtml(priorityPie)}</div>
      </div>
    </div>
    <div class="ch-g">
      <div class="ch-b">
        <p class="ch-t">Demandas por Estado</p>
        <svg width="100%" height="200" viewBox="0 0 280 200" style="max-width:280px">
          ${donutChart(ufPie, 140, 100, 80, 45)}
        </svg>
        <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:8px">
          ${ufPie.map(d => `<span style="font-size:9px;color:#64748b;font-family:monospace;font-weight:700">${d.name}</span>`).join('')}
        </div>
      </div>
      <div class="ch-b">
        <p class="ch-t">Evolução por Ano</p>
        <svg width="100%" height="200" viewBox="0 0 ${Math.max(280, m.byYear.length * 50 + 60)} 200" style="max-width:100%">
          ${lineChart(m.byYear, Math.max(280, m.byYear.length * 50 + 60), 200)}
        </svg>
      </div>
    </div>
    <div class="ch-b" style="margin-top:8px">
      <p class="ch-t">Top 10 — Valor por Município</p>
      <svg width="100%" height="${Math.max(200, topMunBar.length * 28 + 30)}" viewBox="0 0 580 ${Math.max(200, topMunBar.length * 28 + 30)}" style="max-width:580px;margin:0 auto">
        ${barChart(topMunBar, 580, Math.max(200, topMunBar.length * 28 + 30), fc)}
      </svg>
    </div>
  </div>
  ${pageFooter()}
</div>

<!-- ===== PAGE 5: TABELA ===== -->
<div class="pg">
  ${pageHeader(5, totalPages, shortDate)}
  <div class="pg-bd">
    <h2 style="font-size:18px;font-weight:900;color:#0f172a;margin-bottom:6px">Tabela Executiva</h2>
    <p style="font-size:11px;color:#94a3b8;margin-bottom:14px">${demands.length} demandas</p>
    <div class="tb-w">
      <table class="tb">
        <thead><tr><th>ID</th><th>Título</th><th>Município/UF</th><th>Órgão</th><th>Ano</th><th>Status</th><th>Prioridade</th><th>Valor</th><th>Data</th></tr></thead>
        <tbody>
          ${demands.map(d => {
            const stColor = SC[d.status] || '#94a3b8';
            const prColor = PC[d.priority] || '#94a3b8';
            return `<tr>
              <td class="cid">${esc(d.id)}</td>
              <td class="ctit" title="${esc(d.title)}">${esc(d.title)}</td>
              <td class="cmun">${esc(d.municipality)}/${esc(d.uf)}</td>
              <td class="corg" title="${esc(d.organ || '')}">${esc(d.organ || '—')}</td>
              <td class="cano">${d.ano || '—'}</td>
              <td><span class="cst" style="background:${stColor}18;color:${stColor}">${esc(SL[d.status] || d.status)}</span></td>
              <td><span class="cpr" style="color:${prColor}">${esc(PL[d.priority] || d.priority)}</span></td>
              <td class="cval">${fmt(d.requested_value || 0)}</td>
              <td class="cdat">${fd(d.created_at)}</td>
            </tr>`;
          }).join('\n')}
        </tbody>
      </table>
    </div>
  </div>
  ${pageFooter()}
</div>

<!-- ===== PAGE 6: RECOMENDAÇÕES ===== -->
<div class="pg">
  ${pageHeader(6, totalPages, shortDate)}
  <div class="pg-bd">
    ${sectionTitle('Recomendações Estratégicas', '#059669', iconTarget)}
    <div class="rec-l">
      ${recs.map((r, i) => `<div class="rec-i"><span class="rec-n">${i + 1}</span><p class="rec-t">${r}</p></div>`).join('\n')}
    </div>
    <div class="rec-concl">
      <p class="sn">Sistema de Gestão de Demandas — SGD</p>
      <p>Relatório gerado automaticamente em ${dateStr} às ${timeStr}</p>
      <p style="font-size:9px;color:#cbd5e1">Este documento é confidencial e destinado ao uso interno.</p>
    </div>
  </div>
  ${pageFooter()}
</div>

<script>
(function(){var btn=document.querySelector('.scr-btn button');if(btn)btn.addEventListener('click',function(){window.print()})})();
</script>
</body>
</html>`;
}

function esc(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, ch => map[ch] || ch);
}

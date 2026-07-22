import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Download, Printer, Sparkles, BrainCircuit, Lightbulb, Target,
  BarChart3, FileText, TrendingUp, Award, CheckCircle2
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line
} from 'recharts';
import { Demand } from '../types';

const STATUS_LABELS: Record<string, string> = { pendente: 'Pendente', analise: 'Em Análise', concluido: 'Concluído', rejeitado: 'Rejeitado' };
const PRIORITY_LABELS: Record<string, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };
const STATUS_COLORS: Record<string, string> = { pendente: '#f59e0b', analise: '#3b5bdb', concluido: '#10b981', rejeitado: '#f43f5e' };
const PRIORITY_COLORS: Record<string, string> = { baixa: '#94a3b8', media: '#3b82f6', alta: '#f59e0b', urgente: '#f43f5e' };

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCompact = (v: number) => {
  if (v >= 1e9) return `R$ ${(v / 1e9).toFixed(2)} bi`;
  if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(2)} mi`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toFixed(1)} mil`;
  return fmt(v);
};
const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('pt-BR');

interface ReportMetrics {
  total: number; totalValue: number; approvedValue: number; concludedValue: number; rejectedValue: number;
  byStatus: Record<string, number>; byPriority: Record<string, number>;
  byUf: Record<string, number>; byMunicipio: Record<string, { count: number; value: number }>;
  byYear: { year: string; count: number }[];
  municipalities: number; states: number; organs: number;
  avgTime: number; concludedCount: number;
  maxDemand: { title: string; value: number }; minDemand: { title: string; value: number };
  avgValue: number; approvalRate: number; conclusionRate: number;
  topMunicipio: { name: string; count: number };
  topMunicipioValue: { name: string; value: number };
  topStatus: { name: string; count: number; pct: string };
  topPriority: { name: string; count: number; pct: string };
  topOrgan: { name: string; count: number };
  criticalCount: number; overdueCount: number;
  oldestDemand: { title: string; days: number }; newestDemand: { title: string; days: number };
}

function computeMetrics(demands: Demand[]): ReportMetrics {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byUf: Record<string, number> = {};
  const byMunicipio: Record<string, { count: number; value: number }> = {};
  const byOrgan: Record<string, { count: number; value: number }> = {};
  const byYearMap: Record<string, number> = {};
  let totalValue = 0, concludedValue = 0, rejectedValue = 0;
  let maxVal = 0, minVal = Infinity, maxTitle = '', minTitle = '';
  let oldestDate = Date.now(), oldestTitle = '', newestDate = 0, newestTitle = '';
  let overdue = 0, critical = 0;
  const completedTimes: number[] = [];
  const SLA: Record<string, number> = { baixa: 45, media: 30, alta: 15, urgente: 5 };

  for (const d of demands) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    byPriority[d.priority] = (byPriority[d.priority] || 0) + 1;
    byUf[d.uf] = (byUf[d.uf] || 0) + 1;
    const val = d.requested_value || 0;
    totalValue += val;
    const mkey = `${d.municipality}/${d.uf}`;
    if (!byMunicipio[mkey]) byMunicipio[mkey] = { count: 0, value: 0 };
    byMunicipio[mkey].count++; byMunicipio[mkey].value += val;
    const okey = d.organ || 'Não informado';
    if (!byOrgan[okey]) byOrgan[okey] = { count: 0, value: 0 };
    byOrgan[okey].count++; byOrgan[okey].value += val;
    const year = String(d.ano || new Date(d.created_at).getFullYear());
    byYearMap[year] = (byYearMap[year] || 0) + 1;
    if (val > maxVal) { maxVal = val; maxTitle = d.title; }
    if (val < minVal && val > 0) { minVal = val; minTitle = d.title; }
    const created = new Date(d.created_at).getTime();
    if (created < oldestDate) { oldestDate = created; oldestTitle = d.title; }
    if (created > newestDate) { newestDate = created; newestTitle = d.title; }
    const age = (Date.now() - created) / 86400000;
    if ((d.status === 'pendente' || d.status === 'analise') && age > (SLA[d.priority] || 30)) overdue++;
    if (d.priority === 'urgente' || d.priority === 'alta') critical++;
    if (d.status === 'concluido') {
      concludedValue += val;
      completedTimes.push((new Date(d.updated_at).getTime() - created) / 86400000);
    }
    if (d.status === 'rejeitado') rejectedValue += val;
  }

  const years = Object.keys(byYearMap).sort();
  const byYear: { year: string; count: number }[] = [];
  if (years.length > 0) {
    for (let y = parseInt(years[0]); y <= parseInt(years[years.length - 1]); y++) {
      byYear.push({ year: String(y), count: byYearMap[String(y)] || 0 });
    }
  }

  const total = demands.length;
  const approvedValue = Object.entries(byStatus).filter(([k]) => ['analise', 'concluido'].includes(k)).reduce((s, [, v]) => s + v, 0);

  const sortedMuni = Object.entries(byMunicipio).sort((a, b) => b[1].count - a[1].count);
  const sortedMuniVal = Object.entries(byMunicipio).sort((a, b) => b[1].value - a[1].value);
  const sortedOrgan = Object.entries(byOrgan).sort((a, b) => b[1].count - a[1].count);
  const topSt = Object.entries(byStatus).sort((a, b) => b[1] - a[1])[0];
  const topPr = Object.entries(byPriority).sort((a, b) => b[1] - a[1])[0];

  return {
    total, totalValue, approvedValue: byStatus.analise || 0, concludedValue, rejectedValue,
    byStatus, byPriority, byUf, byMunicipio,
    byYear,
    municipalities: Object.keys(byMunicipio).length,
    states: Object.keys(byUf).length,
    organs: Object.keys(byOrgan).length,
    avgTime: completedTimes.length > 0 ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length : 0,
    concludedCount: byStatus.concluido || 0,
    maxDemand: { title: maxTitle, value: maxVal },
    minDemand: { title: minTitle, value: minVal === Infinity ? 0 : minVal },
    avgValue: total > 0 ? totalValue / total : 0,
    approvalRate: total > 0 ? Math.round(((byStatus.analise || 0) + (byStatus.concluido || 0)) / total * 100) : 0,
    conclusionRate: total > 0 ? Math.round((byStatus.concluido || 0) / total * 100) : 0,
    topMunicipio: sortedMuni.length > 0 ? { name: sortedMuni[0][0], count: sortedMuni[0][1].count } : { name: '', count: 0 },
    topMunicipioValue: sortedMuniVal.length > 0 ? { name: sortedMuniVal[0][0], value: sortedMuniVal[0][1].value } : { name: '', value: 0 },
    topStatus: topSt ? { name: STATUS_LABELS[topSt[0]] || topSt[0], count: topSt[1], pct: total > 0 ? ((topSt[1] / total) * 100).toFixed(1) : '0' } : { name: '', count: 0, pct: '0' },
    topPriority: topPr ? { name: PRIORITY_LABELS[topPr[0]] || topPr[0], count: topPr[1], pct: total > 0 ? ((topPr[1] / total) * 100).toFixed(1) : '0' } : { name: '', count: 0, pct: '0' },
    topOrgan: sortedOrgan.length > 0 ? { name: sortedOrgan[0][0], count: sortedOrgan[0][1].count } : { name: '', count: 0 },
    criticalCount: critical, overdueCount: overdue,
    oldestDemand: { title: oldestTitle, days: Math.round((Date.now() - oldestDate) / 86400000) },
    newestDemand: { title: newestTitle, days: Math.round((Date.now() - newestDate) / 86400000) },
  };
}

function generateAnalysis(m: ReportMetrics): string[] {
  const parts: string[] = [];
  const pctPend = m.total > 0 ? ((m.byStatus.pendente || 0) / m.total * 100).toFixed(1) : '0';
  const pctAnal = m.total > 0 ? ((m.byStatus.analise || 0) / m.total * 100).toFixed(1) : '0';
  const pctConc = m.total > 0 ? ((m.byStatus.concluido || 0) / m.total * 100).toFixed(1) : '0';
  const pctRej = m.total > 0 ? ((m.byStatus.rejeitado || 0) / m.total * 100).toFixed(1) : '0';

  parts.push(`Durante o período analisado, foram cadastradas ${m.total} demandas distribuídas entre ${m.municipalities} municípios em ${m.states} estados, totalizando ${fmt(m.totalValue)} em recursos pleiteados.`);
  parts.push(`Observa-se predominância de demandas em status "${m.topStatus.name}", representando ${m.topStatus.pct}% do total. As demandas em análise correspondem a ${pctAnal}% da carteira, ${pctConc}% já foram concluídas, ${pctPend}% permanecem pendentes e ${pctRej}% foram rejeitadas.`);

  const urg = m.byPriority.urgente || 0;
  const alt = m.byPriority.alta || 0;
  if (urg + alt > 0) {
    parts.push(`Em relação à criticidade, ${urg} demanda(s) urgente(s) e ${alt} alta(s) requerem atenção prioritária, totalizando ${m.criticalCount} processos críticos que demandam acompanhamento imediato das equipes.`);
  } else {
    parts.push(`Quanto à criticidade, não há demandas classificadas como urgentes ou de alta prioridade no período, indicando baixa incidência de processos críticos na carteira atual.`);
  }

  parts.push(`O valor médio das propostas é de ${fmt(m.avgValue)}, com a maior demanda avaliada em ${fmt(m.maxDemand.value)} e a menor em ${fmt(m.minDemand.value)}.`);

  if (m.overdueCount > 0) {
    parts.push(`Identificou-se ${m.overdueCount} demanda(s) acima do prazo SLA estabelecido, necessitando de ação corretiva imediata para regularização e mitigação de riscos.`);
  }
  if (m.concludedCount > 0) {
    parts.push(`O tempo médio de tramitação até a conclusão é de ${m.avgTime.toFixed(1)} dias, considerando ${m.concludedCount} demanda(s) finalizada(s) no período, servindo como referência para planejamento de novas demandas.`);
  }

  parts.push(`O município de ${m.topMunicipio.name} concentra o maior número de demandas (${m.topMunicipio.count}), enquanto ${m.topOrgan.name} figura como o órgão mais demandado, sugerindo a necessidade de canal direto de comunicação.`);

  return parts;
}

function generateRecommendations(m: ReportMetrics): string[] {
  const recs: string[] = [];
  if (m.totalValue > 1_000_000) recs.push(`Priorizar acompanhamento das demandas acima de R\$ 1 milhão, que concentram parcela significativa do valor total sob gestão (${fmt(m.totalValue)}).`);
  if (m.overdueCount > 0) recs.push(`Intensificar contato com os municípios que possuem demandas pendentes há mais tempo, visando regularizar ${m.overdueCount} ocorrência(s) fora do SLA.`);
  if ((m.byStatus.rejeitado || 0) > 0) recs.push(`Revisar os ${m.byStatus.rejeitado} processo(s) rejeitado(s) para identificar padrões de inconsistência e evitar novas ocorrências por motivos semelhantes.`);
  if ((m.byStatus.analise || 0) > 10) recs.push(`Monitorar as ${m.byStatus.analise} propostas em análise, estabelecendo metas de agilidade na tramitação para evitar acúmulo de processos.`);
  if (m.municipalities > 5) recs.push(`Direcionar esforços para os municípios com maior potencial de captação, com base no histórico de valores solicitados.`);
  if (m.criticalCount > 0) recs.push(`Estabelecer comitê de acompanhamento para as ${m.criticalCount} demanda(s) críticas (urgentes/altas), com reporte semanal de avanços e indicadores.`);
  if ((m.byStatus.pendente || 0) > (m.byStatus.analise || 0)) recs.push(`Reforçar a equipe de triagem inicial para reduzir o gargalo de ${m.byStatus.pendente} demanda(s) pendente(s) aguardando análise.`);
  recs.push(`Manter a base de dados atualizada e os registros de timeline completos para garantir a rastreabilidade e transparência de todas as demandas.`);
  return recs;
}

interface ExecutiveReportProps {
  demands: Demand[];
  filters: { uf: string; status: string; priority: string; ano: string };
  onClose: () => void;
}

export default function ExecutiveReport({ demands, filters, onClose }: ExecutiveReportProps) {
  const [stage, setStage] = useState(0);
  const [printing, setPrinting] = useState(false);
  const metrics = useMemo(() => computeMetrics(demands), [demands]);
  const analysisParagraphs = useMemo(() => generateAnalysis(metrics), [metrics]);
  const recommendations = useMemo(() => generateRecommendations(metrics), [metrics]);

  useEffect(() => {
    if (stage < 3) { const t = setTimeout(() => setStage(s => s + 1), 800); return () => clearTimeout(t); }
  }, [stage]);

  const statusPie = Object.entries(metrics.byStatus).map(([k, v]) => ({ name: STATUS_LABELS[k], value: v, color: STATUS_COLORS[k] }));
  const priorityPie = Object.entries(metrics.byPriority).map(([k, v]) => ({ name: PRIORITY_LABELS[k], value: v, color: PRIORITY_COLORS[k] }));
  const ufData = Object.entries(metrics.byUf).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 8);
  const topMunVal = Object.entries(metrics.byMunicipio).map(([k, v]) => ({ name: k.split('/')[0], value: v.value })).sort((a, b) => b.value - a.value).slice(0, 10);
  const UF_COLORS = ['#3b5bdb', '#4f46e5', '#6366f1', '#818cf8', '#93b4fd', '#a5b4fc', '#6366f1', '#4f46e5'];

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const filterParts: string[] = [];
  if (filters.uf) filterParts.push(`UF: ${filters.uf}`);
  if (filters.status) filterParts.push(`Status: ${STATUS_LABELS[filters.status]}`);
  if (filters.priority) filterParts.push(`Prioridade: ${PRIORITY_LABELS[filters.priority]}`);
  if (filters.ano) filterParts.push(`Ano: ${filters.ano}`);
  const filterLabel = filterParts.length > 0 ? filterParts.join(' | ') : 'Sem filtros';

  const handlePrint = () => { setPrinting(true); setTimeout(() => { window.print(); setTimeout(() => setPrinting(false), 500); }, 300); };

  if (stage < 3) {
    const msgs = ['Analisando as demandas...', 'Gerando insights estratégicos...', 'Finalizando relatório...'];
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 animate-fade-in">
        <div className="text-center space-y-6">
          <div className="relative">
            <div className="w-20 h-20 border-[3px] border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin mx-auto" />
            <div className="absolute inset-0 flex items-center justify-center"><Sparkles size={28} className="text-indigo-300 animate-pulse" /></div>
          </div>
          <p className="text-white text-lg font-semibold tracking-wide">{msgs[stage]}</p>
          <div className="flex gap-1.5 justify-center">
            {[0, 1, 2].map(i => <span key={i} className={`w-2 h-2 rounded-full transition-all duration-300 ${i <= stage ? 'bg-indigo-400 scale-100' : 'bg-indigo-800 scale-75'}`} />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm 10mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .executive-overlay { position: fixed !important; inset: 0 !important; z-index: 999999 !important; overflow: visible !important; background: white !important; }
          .executive-overlay > div:first-child { display: none !important; }
          .executive-report { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; }
          .report-no-print { display: none !important; }
          .report-section { page-break-inside: avoid; }
          .report-chart-wrap { page-break-inside: avoid; }
          .report-table-wrap { page-break-inside: auto; }
          .report-table-wrap table { page-break-inside: auto; }
          .report-table-wrap tr { page-break-inside: avoid; }
        }
      `}</style>

      <div className="fixed inset-0 z-[70] executive-overlay">
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm report-no-print" onClick={onClose} />
        <div className="relative min-h-screen p-4 md:p-8 overflow-y-auto">
          <div className="max-w-[210mm] mx-auto mb-4 flex items-center justify-between report-no-print">
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all backdrop-blur-sm">
              <X size={14} /> Fechar
            </button>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all backdrop-blur-sm">
                <Printer size={14} /> Imprimir
              </button>
              <button onClick={handlePrint} className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-lg">
                <Download size={14} /> Exportar PDF
              </button>
            </div>
          </div>

          <div className="executive-report max-w-[210mm] mx-auto bg-white shadow-2xl">
            {/* COVER */}
            <div className="report-section" style={{ padding: '56px 44px', minHeight: '297mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'linear-gradient(160deg, #f8faff 0%, #eef2ff 50%, #e8eef8 100%)' }}>
              <div className="flex items-center gap-4 mb-12">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center shadow-lg"><span className="text-white font-black text-2xl tracking-wider">SGD</span></div>
                <div>
                  <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-[0.2em]">Sistema de Gestão de Demandas</p>
                  <p className="text-[8px] text-slate-400 uppercase tracking-wider mt-0.5">Plataforma de Análise e Acompanhamento</p>
                </div>
              </div>
              <div className="flex-1 flex flex-col justify-center">
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-[0.25em] bg-indigo-50 px-3 py-1.5 rounded-full inline-block w-fit mb-4">Relatório Executivo</span>
                <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 leading-tight tracking-tight mb-3">RELATÓRIO EXECUTIVO</h1>
                <p className="text-lg text-slate-500 font-light mb-8">Análise Inteligente das Demandas</p>
                <div className="border-t border-indigo-100 pt-8 max-w-[420px] space-y-2.5 text-sm">
                  <Row label="Data de emissão" value={dateStr} />
                  <Row label="Horário" value={timeStr} />
                  <Row label="Filtros aplicados" value={filterLabel} />
                  <Row label="Total de demandas" value={String(metrics.total)} />
                  <Row label="Municípios envolvidos" value={String(metrics.municipalities)} />
                  <Row label="Valor total solicitado" value={fmt(metrics.totalValue)} />
                </div>
              </div>
              <div className="text-center text-[8px] text-slate-300 uppercase tracking-[0.3em] mt-12">Documento Confidencial — Sistema de Gestão de Demandas</div>
            </div>

            {/* KPIs */}
            <div className="report-section" style={{ padding: '40px', pageBreakBefore: 'always' }}>
              <SectionHeader title="Indicadores Gerenciais" date={dateStr} />
              <div className="grid grid-cols-2 gap-3 mb-6">
                {[
                  { label: 'Total de Demandas', value: String(metrics.total), icon: FileText, color: 'indigo' },
                  { label: 'Valor Solicitado', value: fmtCompact(metrics.totalValue), icon: TrendingUp, color: 'blue' },
                  { label: 'Valor Aprovado', value: fmtCompact(metrics.approvedValue), icon: CheckCircle2, color: 'emerald' },
                  { label: 'Valor Concluído', value: fmtCompact(metrics.concludedValue), icon: Award, color: 'green' },
                  { label: 'Valor Rejeitado', value: fmtCompact(metrics.rejectedValue), icon: X, color: 'red' },
                  { label: 'Taxa de Aprovação', value: `${metrics.approvalRate}%`, icon: TrendingUp, color: 'amber' },
                ].map(k => (
                  <div key={k.label} className="flex items-center gap-3 bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className={`w-10 h-10 rounded-xl bg-${k.color}-50 flex items-center justify-center text-${k.color}-600 shrink-0`}>{React.createElement(k.icon, { size: 18 })}</div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{k.label}</p>
                      <p className="text-sm font-black text-slate-900 mt-0.5">{k.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Municípios', value: String(metrics.municipalities), hint: 'Atendidos' },
                  { label: 'Estados', value: String(metrics.states), hint: 'Envolvidos' },
                  { label: 'Órgãos', value: String(metrics.organs), hint: 'Demandantes' },
                  { label: 'Tempo Médio', value: metrics.avgTime > 0 ? `${metrics.avgTime.toFixed(1)}d` : '—', hint: 'Até conclusão' },
                  { label: 'Valor Médio', value: fmtCompact(metrics.avgValue), hint: 'Por demanda' },
                  { label: 'Taxa Conclusão', value: `${metrics.conclusionRate}%`, hint: `${metrics.concludedCount} concluídas` },
                ].map(k => (
                  <div key={k.label} className="text-center bg-white border border-slate-100 rounded-xl p-3">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{k.label}</p>
                    <p className="text-base font-black text-slate-900 mt-1">{k.value}</p>
                    <p className="text-[8px] text-slate-400 mt-0.5">{k.hint}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* AI ANALYSIS */}
            <div className="report-section" style={{ padding: '40px', pageBreakBefore: 'always' }}>
              <SectionHeader title="Análise Inteligente" date={dateStr} icon={<BrainCircuit size={20} className="text-indigo-600" />} />
              <div className="text-sm text-slate-700 leading-relaxed space-y-4">
                {analysisParagraphs.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </div>

            {/* INSIGHTS */}
            <div className="report-section" style={{ padding: '40px', pageBreakBefore: 'always' }}>
              <SectionHeader title="Insights Automáticos" date={dateStr} icon={<Lightbulb size={20} className="text-amber-500" />} />
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Município com mais demandas', value: metrics.topMunicipio.name, detail: `${metrics.topMunicipio.count} demandas` },
                  { label: 'Município maior valor', value: metrics.topMunicipioValue.name, detail: fmt(metrics.topMunicipioValue.value) },
                  { label: 'Status predominante', value: metrics.topStatus.name, detail: `${metrics.topStatus.count} (${metrics.topStatus.pct}%)` },
                  { label: 'Prioridade predominante', value: metrics.topPriority.name, detail: `${metrics.topPriority.count} (${metrics.topPriority.pct}%)` },
                  { label: 'Maior proposta', value: fmtCompact(metrics.maxDemand.value), detail: metrics.maxDemand.title },
                  { label: 'Menor proposta', value: fmtCompact(metrics.minDemand.value), detail: metrics.minDemand.title },
                  { label: 'Órgão mais demandado', value: metrics.topOrgan.name, detail: `${metrics.topOrgan.count} demandas` },
                  { label: 'Demandas críticas', value: String(metrics.criticalCount), detail: `${metrics.total > 0 ? ((metrics.criticalCount / metrics.total) * 100).toFixed(1) : 0}% do total` },
                  { label: 'Demandas fora do SLA', value: String(metrics.overdueCount), detail: 'Acima do prazo' },
                  { label: 'Demanda mais antiga', value: metrics.oldestDemand.title, detail: `${metrics.oldestDemand.days} dias` },
                  { label: 'Valor médio por demanda', value: fmtCompact(metrics.avgValue), detail: 'Média geral' },
                  { label: 'Concluídas vs Total', value: `${metrics.conclusionRate}%`, detail: `${metrics.concludedCount} de ${metrics.total}` },
                ].map(ins => (
                  <div key={ins.label} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">{ins.label}</p>
                    <p className="text-sm font-bold text-slate-900 truncate" title={ins.value}>{ins.value}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">{ins.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* RECOMMENDATIONS */}
            <div className="report-section" style={{ padding: '40px', pageBreakBefore: 'always' }}>
              <SectionHeader title="Recomendações Estratégicas" date={dateStr} icon={<Target size={20} className="text-emerald-600" />} />
              <div className="space-y-3">
                {recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-4 bg-gradient-to-r from-emerald-50 to-emerald-50/30 rounded-xl p-4 border border-emerald-100">
                    <span className="w-7 h-7 rounded-full bg-emerald-600 text-white text-xs font-black flex items-center justify-center shrink-0">{i + 1}</span>
                    <p className="text-sm text-slate-700 leading-relaxed">{rec}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* CHARTS */}
            <div className="report-section" style={{ padding: '40px', pageBreakBefore: 'always' }}>
              <SectionHeader title="Análise Gráfica" date={dateStr} icon={<BarChart3 size={20} className="text-indigo-600" />} />
              <div className="report-chart-wrap grid grid-cols-2 gap-6 mb-6">
                <ChartCard title="Distribuição por Status">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart><Pie data={statusPie} dataKey="value" innerRadius={35} outerRadius={70} paddingAngle={2}>{statusPie.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <MiniLegend items={statusPie} />
                </ChartCard>
                <ChartCard title="Distribuição por Prioridade">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart><Pie data={priorityPie} dataKey="value" innerRadius={35} outerRadius={70} paddingAngle={2}>{priorityPie.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <MiniLegend items={priorityPie} />
                </ChartCard>
              </div>
              <div className="report-chart-wrap grid grid-cols-2 gap-6 mb-6">
                <ChartCard title="Demandas por Estado">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart><Pie data={ufData} dataKey="value" innerRadius={35} outerRadius={70} paddingAngle={2}>{ufData.map((e, i) => <Cell key={i} fill={UF_COLORS[i % UF_COLORS.length]} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-2 flex-wrap mt-2">{ufData.map(e => <span key={e.name} className="text-[7px] text-slate-500 font-mono">{e.name}</span>)}</div>
                </ChartCard>
                <ChartCard title="Evolução por Ano">
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={metrics.byYear} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Line type="monotone" dataKey="count" name="Demandas" stroke="#3b5bdb" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
              <div className="report-chart-wrap border border-slate-100 rounded-xl p-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 text-center">Top 10 — Valor por Município</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={topMunVal} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 8, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCompact(v)} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 8, fill: '#64748b' }} axisLine={false} tickLine={false} width={90} />
                    <Bar dataKey="value" fill="#3b5bdb" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* DATA TABLE */}
            <div className="report-section" style={{ padding: '40px', pageBreakBefore: 'always' }}>
              <SectionHeader title="Tabela Executiva" date={dateStr} subtitle={`${metrics.total} demandas`} />
              <div className="report-table-wrap overflow-x-auto">
                <table className="w-full text-left text-[8px] border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['ID', 'Título', 'Município', 'UF', 'Órgão', 'Ano', 'Status', 'Prioridade', 'Valor', 'Data'].map(h => (
                        <th key={h} className="px-2 py-2 font-extrabold text-slate-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {demands.map((d, i) => (
                      <tr key={d.id} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                        <td className="px-2 py-1.5 font-mono font-bold text-slate-700">{d.id}</td>
                        <td className="px-2 py-1.5 font-semibold text-slate-800 max-w-[140px] truncate" title={d.title}>{d.title}</td>
                        <td className="px-2 py-1.5 text-slate-600">{d.municipality}</td>
                        <td className="px-2 py-1.5 font-mono font-bold text-slate-500">{d.uf}</td>
                        <td className="px-2 py-1.5 text-slate-600 max-w-[90px] truncate" title={d.organ || ''}>{d.organ || '—'}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-500">{d.ano || '—'}</td>
                        <td className="px-2 py-1.5"><span className="inline-block px-1.5 py-0.5 rounded text-[7px] font-bold uppercase" style={{ backgroundColor: `${STATUS_COLORS[d.status]}15`, color: STATUS_COLORS[d.status] }}>{STATUS_LABELS[d.status]}</span></td>
                        <td className="px-2 py-1.5"><span className="text-[7px] font-bold uppercase" style={{ color: PRIORITY_COLORS[d.priority] }}>{PRIORITY_LABELS[d.priority]}</span></td>
                        <td className="px-2 py-1.5 font-mono font-bold text-slate-800 text-right whitespace-nowrap">{fmt(d.requested_value || 0)}</td>
                        <td className="px-2 py-1.5 text-slate-500 font-mono whitespace-nowrap">{fmtDate(d.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className="text-slate-800 font-semibold text-xs text-right max-w-[220px] truncate">{value}</span>
    </div>
  );
}

function SectionHeader({ title, date, subtitle, icon }: { title: string; date: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
      <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">{icon}{title}</h2>
      <div className="text-right">
        <span className="text-[9px] text-slate-400 font-mono">{date}</span>
        {subtitle && <p className="text-[8px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-100 rounded-xl p-4">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 text-center">{title}</p>
      {children}
    </div>
  );
}

function MiniLegend({ items }: { items: { name: string; value: number; color: string }[] }) {
  return (
    <div className="flex justify-center gap-3 flex-wrap mt-2">
      {items.map(e => (
        <div key={e.name} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
          <span className="text-[7px] text-slate-500">{e.name}: {e.value}</span>
        </div>
      ))}
    </div>
  );
}

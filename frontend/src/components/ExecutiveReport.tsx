import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Download, Printer, Sparkles, BrainCircuit, Lightbulb, Target,
  BarChart3, FileText, TrendingUp, Award, CheckCircle2
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line
} from 'recharts';
import { Demand } from '../types';

const SL = { pendente: 'Pendente', analise: 'Em Análise', concluido: 'Concluído', rejeitado: 'Rejeitado' } as const;
const PL = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' } as const;
const SC: Record<string, string> = { pendente: '#f59e0b', analise: '#3b5bdb', concluido: '#10b981', rejeitado: '#f43f5e' };
const PC: Record<string, string> = { baixa: '#94a3b8', media: '#3b82f6', alta: '#f59e0b', urgente: '#f43f5e' };
const UC = ['#3b5bdb', '#4f46e5', '#6366f1', '#818cf8', '#93b4fd', '#a5b4fc', '#7c3aed', '#6d28d9'];
const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fc = (v: number) => { if (v >= 1e9) return `R$ ${(v / 1e9).toFixed(2)} bi`; if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(2)} mi`; if (v >= 1e3) return `R$ ${(v / 1e3).toFixed(1)} mil`; return fmt(v); };
const fd = (d: string | Date) => new Date(d).toLocaleDateString('pt-BR');
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

interface RM {
  total: number; totalValue: number; approvedValue: number; concludedValue: number; rejectedValue: number;
  byStatus: Record<string, number>; byPriority: Record<string, number>; byUf: Record<string, number>;
  byMun: Record<string, { count: number; value: number }>; byYear: { year: string; count: number }[];
  municipalities: number; states: number; organs: number; avgTime: number; concludedCount: number;
  maxD: { title: string; value: number }; minD: { title: string; value: number }; avgValue: number;
  approvalRate: number; conclusionRate: number;
  topMuni: { name: string; count: number }; topMuniVal: { name: string; value: number };
  topStatus: { name: string; count: number; pct: string }; topPri: { name: string; count: number; pct: string };
  topOrgan: { name: string; count: number }; critical: number; overdue: number;
  oldest: { title: string; days: number }; newest: { title: string; days: number };
}

function compute(demands: Demand[]): RM {
  const byStatus: Record<string, number> = {}, byPriority: Record<string, number> = {}, byUf: Record<string, number> = {};
  const byMun: Record<string, { count: number; value: number }> = {}, byOrgan: Record<string, { count: number; value: number }> = {}, byYearMap: Record<string, number> = {};
  let totalV = 0, concV = 0, rejV = 0, maxV = 0, minV = Infinity, maxT = '', minT = '';
  let oldD = Date.now(), oldT = '', newD = 0, newT = '', overdue = 0, critical = 0;
  const times: number[] = [];
  const SLA = { baixa: 45, media: 30, alta: 15, urgente: 5 };
  for (const d of demands) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1; byPriority[d.priority] = (byPriority[d.priority] || 0) + 1; byUf[d.uf] = (byUf[d.uf] || 0) + 1;
    const val = d.requested_value || 0; totalV += val;
    const mk = `${d.municipality}/${d.uf}`; if (!byMun[mk]) byMun[mk] = { count: 0, value: 0 }; byMun[mk].count++; byMun[mk].value += val;
    const ok = d.organ || 'N/I'; if (!byOrgan[ok]) byOrgan[ok] = { count: 0, value: 0 }; byOrgan[ok].count++; byOrgan[ok].value += val;
    const y = String(d.ano || new Date(d.created_at).getFullYear()); byYearMap[y] = (byYearMap[y] || 0) + 1;
    if (val > maxV) { maxV = val; maxT = d.title; } if (val < minV && val > 0) { minV = val; minT = d.title; }
    const c = new Date(d.created_at).getTime(); if (c < oldD) { oldD = c; oldT = d.title; } if (c > newD) { newD = c; newT = d.title; }
    const age = (Date.now() - c) / 86400000;
    if ((d.status === 'pendente' || d.status === 'analise') && age > (SLA[d.priority] || 30)) overdue++;
    if (d.priority === 'urgente' || d.priority === 'alta') critical++;
    if (d.status === 'concluido') { concV += val; times.push((new Date(d.updated_at).getTime() - c) / 86400000); }
    if (d.status === 'rejeitado') rejV += val;
  }
  const years = Object.keys(byYearMap).sort(); const byYear: { year: string; count: number }[] = [];
  if (years.length > 0) for (let y = parseInt(years[0]); y <= parseInt(years[years.length - 1]); y++) byYear.push({ year: String(y), count: byYearMap[String(y)] || 0 });
  const total = demands.length;
  const sm = Object.entries(byMun).sort((a, b) => b[1].count - a[1].count);
  const smv = Object.entries(byMun).sort((a, b) => b[1].value - a[1].value);
  const so = Object.entries(byOrgan).sort((a, b) => b[1].count - a[1].count);
  const ts = Object.entries(byStatus).sort((a, b) => b[1] - a[1])[0];
  const tp = Object.entries(byPriority).sort((a, b) => b[1] - a[1])[0];
  return {
    total, totalValue: totalV, approvedValue: byStatus.analise || 0, concludedValue: concV, rejectedValue: rejV,
    byStatus, byPriority, byUf, byMun, byYear, municipalities: Object.keys(byMun).length, states: Object.keys(byUf).length, organs: Object.keys(byOrgan).length,
    avgTime: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0, concludedCount: byStatus.concluido || 0,
    maxD: { title: maxT, value: maxV }, minD: { title: minT, value: minV === Infinity ? 0 : minV },
    avgValue: total > 0 ? totalV / total : 0,
    approvalRate: total > 0 ? Math.round(((byStatus.analise || 0) + (byStatus.concluido || 0)) / total * 100) : 0,
    conclusionRate: total > 0 ? Math.round((byStatus.concluido || 0) / total * 100) : 0,
    topMuni: sm.length > 0 ? { name: sm[0][0], count: sm[0][1].count } : { name: '', count: 0 },
    topMuniVal: smv.length > 0 ? { name: smv[0][0], value: smv[0][1].value } : { name: '', value: 0 },
    topStatus: ts ? { name: SL[ts[0] as keyof typeof SL] || ts[0], count: ts[1], pct: total > 0 ? ((ts[1] / total) * 100).toFixed(1) : '0' } : { name: '', count: 0, pct: '0' },
    topPri: tp ? { name: PL[tp[0] as keyof typeof PL] || tp[0], count: tp[1], pct: total > 0 ? ((tp[1] / total) * 100).toFixed(1) : '0' } : { name: '', count: 0, pct: '0' },
    topOrgan: so.length > 0 ? { name: so[0][0], count: so[0][1].count } : { name: '', count: 0 },
    critical, overdue, oldest: { title: oldT, days: Math.round((Date.now() - oldD) / 86400000) }, newest: { title: newT, days: Math.round((Date.now() - newD) / 86400000) },
  };
}

function genAnalysis(m: RM): string[] {
  const p = [] as string[];
  const pp = m.total > 0 ? ((m.byStatus.pendente || 0) / m.total * 100).toFixed(1) : '0';
  const pa = m.total > 0 ? ((m.byStatus.analise || 0) / m.total * 100).toFixed(1) : '0';
  const pc = m.total > 0 ? ((m.byStatus.concluido || 0) / m.total * 100).toFixed(1) : '0';
  const pr = m.total > 0 ? ((m.byStatus.rejeitado || 0) / m.total * 100).toFixed(1) : '0';
  p.push(`Durante o período analisado, foram cadastradas ${m.total} demandas distribuídas entre ${m.municipalities} municípios em ${m.states} estados, totalizando ${fmt(m.totalValue)} em recursos pleiteados.`);
  p.push(`A distribuição por status revela que ${pa}% das demandas encontram-se em análise, ${pc}% foram concluídas, ${pp}% permanecem pendentes e ${pr}% foram rejeitadas. O status "${m.topStatus.name}" é predominante, representando ${m.topStatus.pct}% da carteira.`);
  const urg = m.byPriority.urgente || 0, alt = m.byPriority.alta || 0;
  if (urg + alt > 0) p.push(`Em relação à criticidade, ${urg} demanda(s) urgente(s) e ${alt} de alta prioridade totalizam ${m.critical} processos críticos que demandam acompanhamento imediato das equipes técnicas.`);
  else p.push(`Não foram identificadas demandas classificadas como urgentes ou de alta prioridade no período, indicando baixa incidência de processos críticos na carteira atual.`);
  p.push(`O valor médio das propostas é de ${fmt(m.avgValue)}, com a maior demanda avaliada em ${fmt(m.maxD.value)} e a menor em ${fmt(m.minD.value)}.`);
  if (m.overdue > 0) p.push(`Identificou-se ${m.overdue} demanda(s) acima do prazo SLA estabelecido, necessitando de ação corretiva imediata para mitigação de riscos institucionais.`);
  if (m.concludedCount > 0) p.push(`O tempo médio de tramitação até a conclusão é de ${m.avgTime.toFixed(1)} dias, considerando ${m.concludedCount} demanda(s) finalizada(s) no período.`);
  return p;
}

function genRecs(m: RM): string[] {
  const r: string[] = [];
  if (m.totalValue > 1_000_000) r.push(`Priorizar acompanhamento das demandas acima de R\$ 1 milhão, que concentram parcela significativa do valor total sob gestão (${fmt(m.totalValue)}).`);
  if (m.overdue > 0) r.push(`Intensificar contato com os municípios que possuem demandas pendentes há mais tempo, visando regularizar ${m.overdue} ocorrência(s) fora do SLA.`);
  if ((m.byStatus.rejeitado || 0) > 0) r.push(`Revisar os ${m.byStatus.rejeitado} processo(s) rejeitado(s) para identificar padrões de inconsistência e evitar novas ocorrências.`);
  if ((m.byStatus.analise || 0) > 10) r.push(`Monitorar as ${m.byStatus.analise} propostas em análise, estabelecendo metas de agilidade na tramitação para evitar acúmulo de processos.`);
  if (m.municipalities > 5) r.push(`Direcionar esforços para os municípios com maior potencial de captação, com base no histórico de valores solicitados.`);
  if (m.critical > 0) r.push(`Estabelecer comitê de acompanhamento para as ${m.critical} demanda(s) críticas, com reporte semanal de avanços e indicadores de desempenho.`);
  if ((m.byStatus.pendente || 0) > (m.byStatus.analise || 0)) r.push(`Reforçar a equipe de triagem inicial para reduzir o gargalo de ${m.byStatus.pendente} demanda(s) pendente(s) aguardando análise.`);
  r.push(`Manter a base de dados atualizada e os registros de timeline completos para garantir a rastreabilidade e transparência de todas as demandas.`);
  return r;
}

interface Props { demands: Demand[]; filters: { uf: string; status: string; priority: string; ano: string }; onClose: () => void; }

export default function ExecutiveReport({ demands, filters, onClose }: Props) {
  const [stage, setStage] = useState(0);
  const metrics = useMemo(() => compute(demands), [demands]);
  const analysis = useMemo(() => genAnalysis(metrics), [metrics]);
  const recommendations = useMemo(() => genRecs(metrics), [metrics]);
  useEffect(() => { if (stage < 3) { const t = setTimeout(() => setStage(s => s + 1), 700); return () => clearTimeout(t); } }, [stage]);

  const statusPie = Object.entries(metrics.byStatus).map(([k, v]) => ({ name: SL[k as keyof typeof SL], value: v, color: SC[k] }));
  const priorityPie = Object.entries(metrics.byPriority).map(([k, v]) => ({ name: PL[k as keyof typeof PL], value: v, color: PC[k] }));
  const ufData = Object.entries(metrics.byUf).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 8);
  const topMun = Object.entries(metrics.byMun).map(([k, v]) => ({ name: k.split('/')[0], value: v.value })).sort((a, b) => b.value - a.value).slice(0, 10);

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const shortDate = now.toLocaleDateString('pt-BR');
  const fp: string[] = [];
  if (filters.uf) fp.push(`UF: ${filters.uf}`);
  if (filters.status) fp.push(`Status: ${SL[filters.status as keyof typeof SL]}`);
  if (filters.priority) fp.push(`Prioridade: ${PL[filters.priority as keyof typeof PL]}`);
  if (filters.ano) fp.push(`Ano: ${filters.ano}`);
  const filterLabel = fp.length > 0 ? fp.join(' | ') : 'Sem filtros';

  const handlePrint = () => { setTimeout(() => window.print(), 300); };

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
          <div className="flex gap-1.5 justify-center">{[0, 1, 2].map(i => <span key={i} className={`w-2 h-2 rounded-full transition-all duration-300 ${i <= stage ? 'bg-indigo-400 scale-100' : 'bg-indigo-800 scale-75'}`} />)}</div>
        </div>
      </div>
    );
  }

  const totalPages = 7;
  const pageInfo = (page: number) => `${shortDate} | SGD — Relatório Executivo | Página ${page} de ${totalPages}`;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 25mm 20mm 20mm 20mm; }
          @page :first { margin-top: 25mm; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif !important; }
          .exec-overlay { position: fixed !important; inset: 0 !important; z-index: 999999 !important; background: white !important; }
          .exec-overlay > .report-bg { display: none !important; }
          .exec-report { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; }
          .report-no-print { display: none !important; }
          .page-section { page-break-before: always; }
          .page-cover { page-break-after: always; page-break-before: auto; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
          .table-print thead { display: table-header-group; }
          .table-print tbody { display: table-row-group; }
          .table-print tr { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>

      <div className="fixed inset-0 z-[70] exec-overlay">
        <div className="report-bg absolute inset-0 bg-slate-900/60 backdrop-blur-sm report-no-print" onClick={onClose} />
        <div className="relative min-h-screen p-4 md:p-8 overflow-y-auto">
          <div className="max-w-[210mm] mx-auto mb-4 flex items-center justify-between report-no-print">
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 backdrop-blur-sm">
              <X size={14} /> Fechar
            </button>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 backdrop-blur-sm">
                <Printer size={14} /> Imprimir
              </button>
              <button onClick={handlePrint} className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg">
                <Download size={14} /> Exportar PDF
              </button>
            </div>
          </div>

          <div className="exec-report max-w-[210mm] mx-auto bg-white shadow-2xl text-[12px] leading-relaxed text-slate-800" style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}>

            {/* ===== PAGE 1: COVER ===== */}
            <div className="page-cover" style={{ minHeight: '297mm', display: 'flex', flexDirection: 'column', background: 'linear-gradient(165deg, #f8faff 0%, #eef2ff 50%, #e8eef8 100%)' }}>
              <div className="flex-1 flex flex-col px-[20mm] py-[25mm]">
                <div className="flex items-center gap-4 mb-16">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center shadow-lg">
                    <span className="text-white font-black text-2xl tracking-wider">SGD</span>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-[0.2em]">Sistema de Gestão de Demandas</p>
                    <p className="text-[8px] text-slate-400 uppercase tracking-wider mt-0.5">Plataforma de Análise e Acompanhamento</p>
                  </div>
                </div>
                <div className="flex-1 flex flex-col justify-center">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-[0.25em] bg-indigo-50 px-3 py-1.5 rounded-full inline-block w-fit mb-5">Relatório Executivo</span>
                  <h1 className="text-[32px] font-extrabold text-slate-900 leading-tight tracking-tight mb-3">RELATÓRIO EXECUTIVO</h1>
                  <p className="text-[22px] text-slate-500 font-light mb-10">Análise Inteligente das Demandas</p>
                  <div className="border-t border-indigo-100 pt-8 max-w-[420px] space-y-2.5">
                    <CovRow label="Data de emissão" value={dateStr} />
                    <CovRow label="Horário" value={timeStr} />
                    <CovRow label="Filtros aplicados" value={filterLabel} />
                    <CovRow label="Total de demandas" value={String(metrics.total)} />
                    <CovRow label="Municípios envolvidos" value={String(metrics.municipalities)} />
                    <CovRow label="Valor total solicitado" value={fmt(metrics.totalValue)} />
                  </div>
                </div>
              </div>
              <div className="text-center text-[10px] text-slate-400 border-t border-indigo-100/50 py-4 px-[20mm] flex justify-between">
                <span>Documento Confidencial</span>
                <span>Sistema de Gestão de Demandas</span>
                <span>{shortDate}</span>
              </div>
            </div>

            {/* PAGE HEADER (reused for pages 2-7) */}
            {/* ===== PAGE 2: KPI INDICATORS ===== */}
            <div className="page-section avoid-break" style={{ padding: '0 0 24px 0' }}>
              <PageHeader text={pageInfo(2)} />
              <SectionTitle>Indicadores Gerenciais</SectionTitle>
              <div className="grid grid-cols-2 gap-5 mb-6">
                {[
                  { label: 'Total de Demandas', value: String(metrics.total), icon: FileText, color: 'indigo' },
                  { label: 'Valor Solicitado', value: fc(metrics.totalValue), icon: TrendingUp, color: 'blue' },
                  { label: 'Valor Aprovado', value: fc(metrics.approvedValue), icon: CheckCircle2, color: 'emerald' },
                  { label: 'Valor Concluído', value: fc(metrics.concludedValue), icon: Award, color: 'green' },
                  { label: 'Valor Rejeitado', value: fc(metrics.rejectedValue), icon: X, color: 'red' },
                  { label: 'Taxa de Aprovação', value: `${metrics.approvalRate}%`, icon: TrendingUp, color: 'amber' },
                ].map(k => (
                  <div key={k.label} className="flex items-center gap-4 bg-slate-50 rounded-xl p-5 border border-slate-100">
                    <div className={`w-11 h-11 rounded-xl bg-${k.color}-50 flex items-center justify-center text-${k.color}-600 shrink-0`}>
                      {React.createElement(k.icon, { size: 20 })}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{k.label}</p>
                      <p className="text-base font-black text-slate-900 mt-0.5">{k.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Municípios', value: String(metrics.municipalities), hint: 'Atendidos' },
                  { label: 'Estados', value: String(metrics.states), hint: 'Envolvidos' },
                  { label: 'Órgãos', value: String(metrics.organs), hint: 'Demandantes' },
                  { label: 'Tempo Médio', value: metrics.avgTime > 0 ? `${metrics.avgTime.toFixed(1)}d` : '—', hint: 'Até conclusão' },
                  { label: 'Valor Médio', value: fc(metrics.avgValue), hint: 'Por demanda' },
                  { label: 'Taxa Conclusão', value: `${metrics.conclusionRate}%`, hint: `${metrics.concludedCount} concluídas` },
                ].map(k => (
                  <div key={k.label} className="text-center bg-white border border-slate-100 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{k.label}</p>
                    <p className="text-[18px] font-black text-slate-900 mt-1">{k.value}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{k.hint}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ===== PAGE 3: AI ANALYSIS ===== */}
            <div className="page-section avoid-break" style={{ padding: '0 0 24px 0' }}>
              <PageHeader text={pageInfo(3)} />
              <SectionTitle icon={<BrainCircuit size={20} className="text-indigo-600" />}>Análise da IA</SectionTitle>
              <div className="text-[12px] text-slate-700 leading-relaxed space-y-4" style={{ lineHeight: 1.8 }}>
                {analysis.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </div>

            {/* ===== PAGE 4: INSIGHTS ===== */}
            <div className="page-section avoid-break" style={{ padding: '0 0 24px 0' }}>
              <PageHeader text={pageInfo(4)} />
              <SectionTitle icon={<Lightbulb size={20} className="text-amber-500" />}>Insights Automáticos</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Município com mais demandas', value: metrics.topMuni.name, detail: `${metrics.topMuni.count} demandas` },
                  { label: 'Município com maior valor', value: metrics.topMuniVal.name, detail: fmt(metrics.topMuniVal.value) },
                  { label: 'Status predominante', value: metrics.topStatus.name, detail: `${metrics.topStatus.count} (${metrics.topStatus.pct}%)` },
                  { label: 'Prioridade predominante', value: metrics.topPri.name, detail: `${metrics.topPri.count} (${metrics.topPri.pct}%)` },
                  { label: 'Maior proposta', value: fc(metrics.maxD.value), detail: metrics.maxD.title },
                  { label: 'Menor proposta', value: fc(metrics.minD.value), detail: metrics.minD.title },
                  { label: 'Órgão mais demandado', value: metrics.topOrgan.name, detail: `${metrics.topOrgan.count} demandas` },
                  { label: 'Demandas críticas', value: String(metrics.critical), detail: `${metrics.total > 0 ? ((metrics.critical / metrics.total) * 100).toFixed(1) : 0}% do total` },
                  { label: 'Demandas fora do SLA', value: String(metrics.overdue), detail: 'Acima do prazo' },
                  { label: 'Valor médio por demanda', value: fc(metrics.avgValue), detail: 'Média geral' },
                ].map(ins => (
                  <div key={ins.label} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">{ins.label}</p>
                    <p className="text-sm font-bold text-slate-900 truncate" title={ins.value}>{ins.value || '—'}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">{ins.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ===== PAGE 5: CHARTS ===== */}
            <div className="page-section" style={{ padding: '0 0 24px 0' }}>
              <PageHeader text={pageInfo(5)} />
              <SectionTitle icon={<BarChart3 size={20} className="text-indigo-600" />}>Análise Gráfica</SectionTitle>
              <div className="avoid-break grid grid-cols-2 gap-6 mb-6">
                <ChartBox title="Distribuição por Status">
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart><Pie data={statusPie} dataKey="value" innerRadius={40} outerRadius={75} paddingAngle={2}>{statusPie.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <LegendLine items={statusPie} />
                </ChartBox>
                <ChartBox title="Distribuição por Prioridade">
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart><Pie data={priorityPie} dataKey="value" innerRadius={40} outerRadius={75} paddingAngle={2}>{priorityPie.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <LegendLine items={priorityPie} />
                </ChartBox>
              </div>
              <div className="avoid-break grid grid-cols-2 gap-6 mb-6">
                <ChartBox title="Demandas por Estado (Top 8)">
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart><Pie data={ufData} dataKey="value" innerRadius={40} outerRadius={75} paddingAngle={2}>{ufData.map((e, i) => <Cell key={i} fill={UC[i % UC.length]} />)}</Pie></PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-3 flex-wrap mt-2">{ufData.map(e => <span key={e.name} className="text-[9px] text-slate-500 font-mono font-bold">{e.name}</span>)}</div>
                </ChartBox>
                <ChartBox title="Evolução por Ano">
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={metrics.byYear} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Line type="monotone" dataKey="count" name="Demandas" stroke="#3b5bdb" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartBox>
              </div>
              <div className="avoid-break border border-slate-100 rounded-xl p-5">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-4 text-center">Top 10 — Valor por Município</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topMun} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => fc(v)} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} width={95} />
                    <Bar dataKey="value" fill="#3b5bdb" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ===== PAGE 6: DATA TABLE ===== */}
            <div className="page-section" style={{ padding: '0 0 24px 0' }}>
              <PageHeader text={pageInfo(6)} />
              <SectionTitle subtitle={`${metrics.total} demandas`}>Tabela Executiva</SectionTitle>
              <div className="overflow-x-auto">
                <table className="table-print w-full text-left text-[9px] border-collapse">
                  <thead>
                    <tr className="bg-indigo-600 text-white">
                      {['ID', 'Título', 'Município/UF', 'Órgão', 'Ano', 'Status', 'Prioridade', 'Valor', 'Data'].map(h => (
                        <th key={h} className="px-3 py-3 font-bold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {demands.map((d, i) => (
                      <tr key={d.id} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                        <td className="px-3 py-2.5 font-mono font-bold text-slate-700">{d.id}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-800 max-w-[150px]" title={d.title} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</td>
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{d.municipality}/{d.uf}</td>
                        <td className="px-3 py-2.5 text-slate-600 max-w-[100px]" title={d.organ || ''} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.organ || '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-500">{d.ano || '—'}</td>
                        <td className="px-3 py-2.5"><span className="inline-block px-2 py-0.5 rounded text-[8px] font-bold uppercase" style={{ backgroundColor: `${SC[d.status]}18`, color: SC[d.status] }}>{SL[d.status as keyof typeof SL]}</span></td>
                        <td className="px-3 py-2.5"><span className="text-[8px] font-bold uppercase" style={{ color: PC[d.priority] }}>{PL[d.priority as keyof typeof PL]}</span></td>
                        <td className="px-3 py-2.5 font-mono font-bold text-slate-800 text-right whitespace-nowrap">{fmt(d.requested_value || 0)}</td>
                        <td className="px-3 py-2.5 text-slate-500 font-mono whitespace-nowrap">{fd(d.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ===== PAGE 7: RECOMMENDATIONS ===== */}
            <div className="page-section" style={{ padding: '0 0 24px 0' }}>
              <PageHeader text={pageInfo(7)} />
              <SectionTitle icon={<Target size={20} className="text-emerald-600" />}>Recomendações Estratégicas</SectionTitle>
              <div className="space-y-4 mb-8">
                {recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-4 bg-gradient-to-r from-emerald-50 to-white rounded-xl p-5 border border-emerald-100">
                    <span className="w-8 h-8 rounded-full bg-emerald-600 text-white text-sm font-black flex items-center justify-center shrink-0 shadow-sm">{i + 1}</span>
                    <p className="text-[12px] text-slate-700 leading-relaxed pt-0.5">{rec}</p>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-6 mt-6 text-center text-[10px] text-slate-400 space-y-1">
                <p className="font-semibold text-slate-600">Sistema de Gestão de Demandas — SGD</p>
                <p>Relatório gerado automaticamente em {dateStr} às {timeStr}</p>
                <p className="text-[9px] text-slate-300">Este documento é confidencial e destinado ao uso interno.</p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}

function CovRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className="text-slate-800 font-semibold text-xs text-right max-w-[240px]" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

function PageHeader({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-between pb-3 mb-6 border-b border-slate-100" style={{ marginTop: '25mm' }}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center">
          <span className="text-white font-black text-xs">SGD</span>
        </div>
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Relatório Executivo</span>
      </div>
      <span className="text-[10px] text-slate-400 font-mono">{text}</span>
    </div>
  );
}

function SectionTitle({ children, subtitle, icon }: { children: string; subtitle?: string; icon?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-[18px] font-extrabold text-slate-900 flex items-center gap-2">{icon}{children}</h2>
      {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-100 rounded-xl p-5">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-4 text-center">{title}</p>
      {children}
    </div>
  );
}

function LegendLine({ items }: { items: { name: string; value: number; color: string }[] }) {
  return (
    <div className="flex justify-center gap-4 flex-wrap mt-3">
      {items.map(e => (
        <div key={e.name} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: e.color }} />
          <span className="text-[9px] text-slate-500">{e.name}: <strong className="text-slate-700">{e.value}</strong></span>
        </div>
      ))}
    </div>
  );
}

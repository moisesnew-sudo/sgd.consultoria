import { Demand } from '../../types';

export const SL: Record<string, string> = { pendente: 'Pendente', analise: 'Em Análise', concluido: 'Concluído', rejeitado: 'Rejeitado' };
export const PL: Record<string, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };
export const SC: Record<string, string> = { pendente: '#f59e0b', analise: '#3b5bdb', concluido: '#10b981', rejeitado: '#f43f5e' };
export const PC: Record<string, string> = { baixa: '#94a3b8', media: '#3b82f6', alta: '#f59e0b', urgente: '#f43f5e' };
export const UC = ['#3b5bdb', '#4f46e5', '#6366f1', '#818cf8', '#93b4fd', '#a5b4fc', '#7c3aed', '#6d28d9'];

export const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fc = (v: number) => {
  if (v >= 1e9) return `R$ ${(v / 1e9).toFixed(2)} bi`;
  if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(2)} mi`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toFixed(1)} mil`;
  return fmt(v);
};
export const fd = (d: string | Date) => new Date(d).toLocaleDateString('pt-BR');

export interface RM {
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

export function computeMetrics(demands: Demand[]): RM {
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
  const years = Object.keys(byYearMap).sort();
  const byYear: { year: string; count: number }[] = [];
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

export function genAnalysis(m: RM): string[] {
  const p: string[] = [];
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

export function genRecommendations(m: RM): string[] {
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

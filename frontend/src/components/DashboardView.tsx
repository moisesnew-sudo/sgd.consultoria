import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Hourglass,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  MapPin,
  Clock,
  ArrowRight,
  AlertCircle,
  BarChart3,
  PieChart as PieIcon,
  Activity,
  Trophy
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { Demand } from '../types';
import { demandsApi, formatCurrency, formatDate } from '../services/api';
import { Card, Kpi } from './ui/Card';

interface DashboardViewProps {
  onNavigateToTab: (tab: string) => void;
  onSelectDemand: (demand: Demand) => void;
}

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendentes',
  analise: 'Em Análise',
  concluido: 'Concluídas',
  rejeitado: 'Rejeitadas',
};
const STATUS_COLOR: Record<string, string> = {
  pendente: '#f59e0b',
  analise: '#3b5bdb',
  concluido: '#10b981',
  rejeitado: '#f43f5e',
};
const PRIORITY_LABEL: Record<string, string> = {
  baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente',
};
const PRIORITY_COLOR: Record<string, string> = {
  baixa: '#94a3b8', media: '#3b82f6', alta: '#f59e0b', urgente: '#f43f5e',
};

export default function DashboardView({ onNavigateToTab, onSelectDemand }: DashboardViewProps) {
  const [demands, setDemands] = useState<Demand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    try {
      setIsLoading(true);
      const data = await demandsApi.getAll({ limit: 1000 });
      setDemands(data.data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados do dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  const metrics = useMemo(() => {
    const total = demands.length;
    const byStatus = { pendente: 0, analise: 0, concluido: 0, rejeitado: 0 };
    const byPriority = { baixa: 0, media: 0, alta: 0, urgente: 0 };
    let totalValue = 0;
    const municipalitiesSet = new Set<string>();
    let overdue = 0;
    const SLA: Record<string, number> = { baixa: 45, media: 30, alta: 15, urgente: 5 };
    const completed: number[] = [];

    for (const d of demands) {
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      byPriority[d.priority] = (byPriority[d.priority] || 0) + 1;
      totalValue += d.requested_value || 0;
      municipalitiesSet.add(`${d.municipality}-${d.uf}`);
      const ageDays = (Date.now() - new Date(d.created_at).getTime()) / 86400000;
      if ((d.status === 'pendente' || d.status === 'analise') && ageDays > (SLA[d.priority] || 30)) {
        overdue++;
      }
      if (d.status === 'concluido') {
        const created = new Date(d.created_at).getTime();
        const updated = new Date(d.updated_at).getTime();
        completed.push((updated - created) / 86400000);
      }
    }

    const avgTime = completed.length > 0
      ? completed.reduce((a, b) => a + b, 0) / completed.length
      : 0;

    const inProgress = byStatus.analise;

    return {
      total, byStatus, byPriority, totalValue,
      municipalities: municipalitiesSet.size,
      overdue, inProgress, avgTime,
      concluded: byStatus.concluido,
    };
  }, [demands]);

  const charts = useMemo(() => {
    const statusData = Object.entries(metrics.byStatus).map(([k, v]) => ({
      name: STATUS_LABEL[k] || k, key: k, value: v, color: STATUS_COLOR[k] || '#94a3b8',
    }));
    const priorityData = Object.entries(metrics.byPriority).map(([k, v]) => ({
      name: PRIORITY_LABEL[k] || k, key: k, value: v, color: PRIORITY_COLOR[k] || '#94a3b8',
    }));

    const muniMap = new Map<string, { count: number; value: number }>();
    for (const d of demands) {
      const key = `${d.municipality}/${d.uf}`;
      const cur = muniMap.get(key) || { count: 0, value: 0 };
      cur.count++; cur.value += d.requested_value || 0;
      muniMap.set(key, cur);
    }
    const rankingMuni = Array.from(muniMap.entries())
      .map(([k, v]) => ({ name: k, count: v.count, value: v.value }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const progMap = new Map<string, { count: number; value: number }>();
    for (const d of demands) {
      const cur = progMap.get(d.category) || { count: 0, value: 0 };
      cur.count++; cur.value += d.requested_value || 0;
      progMap.set(d.category, cur);
    }
    const rankingProg = Array.from(progMap.entries())
      .map(([k, v]) => ({ name: k, count: v.count, value: v.value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const monthMap = new Map<string, { solicitado: number; concluido: number }>();
    for (const d of demands) {
      const dt = new Date(d.created_at);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const cur = monthMap.get(key) || { solicitado: 0, concluido: 0 };
      cur.solicitado += d.requested_value || 0;
      if (d.status === 'concluido') cur.concluido += d.requested_value || 0;
      monthMap.set(key, cur);
    }
    const evolution = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([k, v]) => ({
        month: k.slice(2),
        solicitado: Math.round(v.solicitado),
        concluido: Math.round(v.concluido),
      }));

    return { statusData, priorityData, rankingMuni, rankingProg, evolution };
  }, [demands, metrics]);

  const recentEvents = useMemo(() => {
    return demands
      .flatMap(d => (d.timeline || []).map(e => ({ ...e, demandId: d.id, demandTitle: d.title })))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);
  }, [demands]);

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-900 dark:border-slate-600 border-t-brand-600 rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-mono">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle size={48} className="text-rose-500" />
          <h3 className="text-lg font-bold text-slate-800 dark:text-white">Erro ao carregar dashboard</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{error}</p>
          <button onClick={loadAll} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700">
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const fmtPct = (n: number) => (metrics.total > 0 ? Math.round((n / metrics.total) * 100) : 0);

  return (
    <div className="space-y-6" id="dashboard-view-root">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 text-xs font-bold uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-brand-500 animate-ping" />
            Painel de Controle
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-1">
            Visão Geral
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onNavigateToTab('new-demand')}
            className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all"
          >
            Nova Demanda
          </button>
          <button
            onClick={() => onNavigateToTab('demands')}
            className="px-4 py-2.5 rounded-xl bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
          >
            Ver Todas
          </button>
        </div>
      </div>

      {/* KPI GRID */}
      <section className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi label="Total de Demandas" value={String(metrics.total)} hint="Cadastradas no sistema" icon={<BarChart3 size={20} />} accent="brand" />
        <Kpi label="Em Andamento" value={String(metrics.inProgress)} hint="Em análise" icon={<Hourglass size={20} />} accent="blue" />
        <Kpi label="Concluídas" value={String(metrics.concluded)} hint={`${fmtPct(metrics.concluded)}% do total`} icon={<CheckCircle2 size={20} />} accent="green" />
        <Kpi label="Atrasadas" value={String(metrics.overdue)} hint="Acima do SLA" icon={<AlertTriangle size={20} />} accent="rose" />
        <Kpi label="Valor Solicitado" value={formatCurrency(metrics.totalValue)} hint="Soma das propostas" icon={<DollarSign size={20} />} accent="violet" />
        <Kpi label="Municípios" value={String(metrics.municipalities)} hint="Atendidos" icon={<MapPin size={20} />} accent="amber" />
      </section>

      {/* SECONDARY KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card title="Tempo Médio de Atendimento" subtitle="Conclusão de demandas" icon={<Clock size={18} />}>
          <p className="text-3xl font-black text-slate-900 dark:text-white">
            {metrics.avgTime > 0 ? `${metrics.avgTime.toFixed(1)}` : '—'}
            <span className="text-base font-bold text-slate-400 dark:text-slate-500 ml-1">dias</span>
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Baseado em {metrics.concluded} demandas concluídas
          </p>
        </Card>
        <Card title="Distribuição por Status" subtitle="Proporção atual" icon={<Activity size={18} />}>
          <div className="space-y-2">
            {Object.entries(metrics.byStatus).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 w-24">{STATUS_LABEL[k]}</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${fmtPct(v)}%`, backgroundColor: STATUS_COLOR[k] }} />
                </div>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 w-8 text-right">{v}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Criticidade" subtitle="Por prioridade" icon={<TrendingUp size={18} />}>
          <div className="space-y-2">
            {(['urgente', 'alta', 'media', 'baixa'] as const).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 w-24">{PRIORITY_LABEL[k]}</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${fmtPct(metrics.byPriority[k])}%`, backgroundColor: PRIORITY_COLOR[k] }} />
                </div>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 w-8 text-right">{metrics.byPriority[k]}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* CHARTS ROW 1 */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Demandas por Status" subtitle="Quantidade" icon={<BarChart3 size={18} />} className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={charts.statusData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:[stroke:#1e293b]" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, background: 'rgba(255,255,255,0.95)' }}
                cursor={{ fill: 'rgba(59,91,219,0.08)' }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Demandas">
                {charts.statusData.map((e) => <Cell key={e.key} fill={e.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Por Prioridade" subtitle="Distribuição" icon={<PieIcon size={18} />}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={charts.priorityData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={3} label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false}>
                {charts.priorityData.map((e) => <Cell key={e.key} fill={e.color} stroke="transparent" />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </section>

      {/* CHARTS ROW 2 - EVOLUTION */}
      <section className="grid grid-cols-1 gap-4">
        <Card title="Evolução Mensal" subtitle="Valor solicitado vs. concluído (R$)" icon={<Activity size={18} />}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={charts.evolution} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:[stroke:#1e293b]" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(v: any) => formatCurrency(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="solicitado" name="Solicitado" stroke="#3b5bdb" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="concluido" name="Concluído" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </section>

      {/* RANKINGS */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Ranking de Municípios" subtitle="Por volume de demandas" icon={<Trophy size={18} />}>
          <div className="space-y-3">
            {charts.rankingMuni.length === 0 && <p className="text-xs text-slate-400">Sem dados.</p>}
            {charts.rankingMuni.map((m, i) => (
              <div key={m.name} className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-black ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-100 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-50 text-slate-400'}`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{m.name}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{m.count}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">{formatCurrency(m.value)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Ranking por Programa" subtitle="Por valor solicitado" icon={<Trophy size={18} />}>
          <div className="space-y-3">
            {charts.rankingProg.length === 0 && <p className="text-xs text-slate-400">Sem dados.</p>}
            {charts.rankingProg.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-black ${i === 0 ? 'bg-violet-100 text-violet-700' : i === 1 ? 'bg-slate-100 text-slate-600' : i === 2 ? 'bg-blue-100 text-blue-700' : 'bg-slate-50 text-slate-400'}`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{p.name}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{formatCurrency(p.value)}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">{p.count} demanda(s)</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* RECENT ACTIVITY */}
      <section>
        <Card title="Atividade Recente" subtitle="Últimas atualizações" icon={<Clock size={18} />}
          action={
            <button onClick={() => onNavigateToTab('demands')} className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1">
              Ver todas <ArrowRight size={14} />
            </button>
          }
        >
          {recentEvents.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">Nenhuma atividade recente encontrada.</div>
          ) : (
            <div className="relative border-l-2 border-slate-100 dark:border-slate-700 ml-3 pl-6 space-y-5">
              {recentEvents.map((evt) => (
                <div key={evt.id} className="relative group cursor-pointer" onClick={() => { onSelectDemand({ id: evt.demandId } as Demand); }}>
                  <span className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 border-white dark:border-[#111a2e] bg-brand-600 shadow-sm" />
                  <div className="space-y-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                      <span className="font-bold text-slate-800 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">{evt.title}</span>
                      <span className="text-[10px] text-slate-400 font-mono bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded">{formatDate(evt.created_at)}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Demanda: <strong className="text-slate-700 dark:text-slate-200">{evt.demandId}</strong> | {evt.demandTitle}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                      <span>Por: <strong>{evt.user_name}</strong></span>
                      {evt.status_changed_to && (
                        <>
                          <span>•</span>
                          <span className="text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/40 px-1.5 py-0.2 rounded font-semibold uppercase">Status: {STATUS_LABEL[evt.status_changed_to]}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

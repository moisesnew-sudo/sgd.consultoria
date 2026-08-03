import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, TrendingUp, DollarSign, Clock, CheckCircle2,
  FilterX, RefreshCw,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts';
import { demandsApi } from '../../services/api';
import { ExecutiveStats } from '../../types';
import { PageHeader, Card, Kpi, Spinner } from '../ui';
import { statusLabel } from '../../lib/demandMeta';

const UF_LIST = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

const STATUS_COLORS: Record<string, string> = {
  pendente: '#f59e0b',
  analise: '#3b82f6',
  concluido: '#10b981',
  rejeitado: '#ef4444',
};

const PIE_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444'];

function heatColor(count: number, max: number): string {
  if (max === 0) return 'bg-slate-50 dark:bg-slate-800/40';
  const t = count / max;
  if (t === 0) return 'bg-slate-50 dark:bg-slate-800/40';
  if (t < 0.15) return 'bg-brand-50 dark:bg-brand-950/30';
  if (t < 0.30) return 'bg-brand-100 dark:bg-brand-900/30';
  if (t < 0.50) return 'bg-brand-200 dark:bg-brand-800/30';
  if (t < 0.70) return 'bg-brand-300 dark:bg-brand-700/30';
  if (t < 0.85) return 'bg-brand-400 dark:bg-brand-600/30';
  return 'bg-brand-500 dark:bg-brand-500/30';
}

function fmtCurrency(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}K`;
  return `R$ ${v.toFixed(0)}`;
}

function fmtNumber(v: number): string {
  return v.toLocaleString('pt-BR');
}

function monthLabel(m: string): string {
  const [year, month] = m.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1);
  return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

export default function ExecutivePanelView() {
  const [data, setData] = useState<ExecutiveStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState('');
  const [uf, setUf] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await demandsApi.getExecutiveStats({ year, uf, status, dateFrom, dateTo });
      setData(result);
    } catch (e) {
      console.error('Executive stats error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const applyFilters = () => fetchData();

  const clearFilters = () => {
    setYear(''); setUf(''); setStatus(''); setDateFrom(''); setDateTo('');
    setTimeout(() => fetchData(), 0);
  };

  const hasFilters = year || uf || status || dateFrom || dateTo;

  const ufMax = useMemo(() => data ? Math.max(...data.byUf.map(u => u.count), 1) : 1, [data]);

  const completionPct = useMemo(() => {
    if (!data || data.summary.total === 0) return 0;
    return Math.round((data.summary.completed / data.summary.total) * 100);
  }, [data]);

  const ufChartData = useMemo(() => data ? data.byUf.map(u => ({ uf: u.uf, demandas: u.count, valor: u.totalValue })) : [], [data]);
  const statusChartData = useMemo(() => data ? data.byStatus.map(s => ({ name: statusLabel(s.status as any), value: s.count, status: s.status })) : [], [data]);
  const monthChartData = useMemo(() => data ? data.byMonth.map(m => ({ month: monthLabel(m.month), demandas: m.count, valor: m.totalValue })) : [], [data]);
  const organChartData = useMemo(() => data ? data.byOrgan.slice(0, 10).reverse() : [], [data]);
  const muniChartData = useMemo(() => data ? data.byMunicipality.slice(0, 10).reverse() : [], [data]);

  const years = useMemo(() => {
    if (!data) return [];
    const ys = new Set(data.byMonth.map(m => m.month.split('-')[0]));
    return Array.from(ys).sort().reverse();
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel Executivo"
        subtitle="Visao estrategica consolidada"
        icon={<BarChart3 size={24} />}
        actions={
          hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-red-600 transition-colors">
              <FilterX size={14} /> Limpar filtros
            </button>
          )
        }
      />

      {/* FILTROS */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-3 shadow-sm flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">
          <FilterX size={12} /> Filtros
        </div>
        <select value={year} onChange={e => setYear(e.target.value)} className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">
          <option value="">Todos os Anos</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={uf} onChange={e => setUf(e.target.value)} className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">
          <option value="">Todas as UFs</option>
          {UF_LIST.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">
          <option value="">Todos os Status</option>
          <option value="pendente">Pendente</option>
          <option value="analise">Em Analise</option>
          <option value="concluido">Concluido</option>
          <option value="rejeitado">Rejeitado</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200" />
        <button onClick={applyFilters} className="ml-auto flex items-center gap-1.5 text-xs font-bold text-brand-600 dark:text-brand-400 hover:text-brand-700 px-3 py-1.5 rounded-lg bg-brand-50 dark:bg-brand-950/30 transition-colors">
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : !data ? (
        <p className="text-center text-sm text-slate-400 py-20">Erro ao carregar dados.</p>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Kpi label="Total de Demandas" value={fmtNumber(data.summary.total)} icon={<BarChart3 size={18} />} accent="brand" />
            <Kpi label="Valor Global" value={fmtCurrency(data.summary.totalValue)} icon={<DollarSign size={18} />} accent="gov" />
            <Kpi label="Valor Medio" value={fmtCurrency(data.summary.avgValue)} icon={<TrendingUp size={18} />} accent="blue" />
            <Kpi label="Pendentes" value={fmtNumber(data.summary.pending)} icon={<Clock size={18} />} accent="amber" />
            <Kpi label="Concluidas" value={`${completionPct}%`} hint={`${data.summary.completed} demandas`} icon={<CheckCircle2 size={18} />} accent="green" />
          </div>

          {/* MAPA DE CALOR POR UF + STATUS PIE */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Card title="Demandas por Estado" subtitle={`${data.byUf.length} UFs com demandas`}>
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-1.5">
                  {UF_LIST.map(ufItem => {
                    const found = data.byUf.find(u => u.uf === ufItem);
                    const count = found?.count || 0;
                    return (
                      <div key={ufItem} className={`rounded-lg p-2 text-center transition-colors ${heatColor(count, ufMax)} group cursor-default`}>
                        <span className="block text-[10px] font-black text-slate-700 dark:text-slate-200">{ufItem}</span>
                        <span className="block text-sm font-bold text-slate-900 dark:text-white">{count}</span>
                        {found && (
                          <span className="block text-[8px] text-slate-500 dark:text-slate-400 truncate">{fmtCurrency(found.totalValue)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
            <div>
              <Card title="Distribuicao por Status">
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value" strokeWidth={0}>
                        {statusChartData.map((entry, i) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => [`${v} demanda(s)`, 'Quantidade']} />
                      <Legend iconType="circle" iconSize={8} formatter={(value: string) => <span className="text-[11px] text-slate-600 dark:text-slate-300">{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {data.byStatus.map(s => (
                    <div key={s.status} className="flex items-center gap-2 text-[10px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[s.status] || '#94a3b8' }} />
                      <span className="text-slate-500 truncate">{statusLabel(s.status as any)}</span>
                      <span className="ml-auto font-bold text-slate-700 dark:text-slate-200">{s.count}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* EVOLUCAO MENSAL */}
          <Card title="Evolucao Mensal" subtitle={`${data.byMonth.length} meses de dados`}>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthChartData}>
                  <defs>
                    <linearGradient id="gradDemandas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                    formatter={(v: any, name: any) => [name === 'demandas' ? `${v} demanda(s)` : fmtCurrency(v), name === 'demandas' ? 'Demandas' : 'Valor']}
                  />
                  <Area type="monotone" dataKey="demandas" stroke="#3b82f6" fill="url(#gradDemandas)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* RANKINGS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Ranking de Municipios" subtitle="Top 10 por quantidade">
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={muniChartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="municipality" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={120} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                      formatter={(v: any, name: any) => [name === 'count' ? `${v} demanda(s)` : fmtCurrency(v), name === 'count' ? 'Demandas' : 'Valor']}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Ranking de Orgaos" subtitle="Top 10 por quantidade">
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={organChartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="organ" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                      formatter={(v: any, name: any) => [name === 'count' ? `${v} demanda(s)` : fmtCurrency(v), name === 'count' ? 'Demandas' : 'Valor']}
                    />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* TABELA RESUMO */}
          <Card title="Resumo por Municipio" subtitle={`${data.byMunicipality.length} municipios`}>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700/50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-2 px-3">Municipio</th>
                    <th className="py-2 px-3 text-center">UF</th>
                    <th className="py-2 px-3 text-right">Demandas</th>
                    <th className="py-2 px-3 text-right">Valor Total</th>
                    <th className="py-2 px-3 text-right">Valor Medio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {data.byMunicipality.map((m, i) => (
                    <tr key={`${m.municipality}-${m.uf}`} className={i % 2 === 0 ? 'bg-white dark:bg-transparent' : 'bg-slate-50/40 dark:bg-slate-800/10'}>
                      <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">{m.municipality}</td>
                      <td className="py-2 px-3 text-center font-mono text-slate-500">{m.uf}</td>
                      <td className="py-2 px-3 text-right font-bold text-slate-700 dark:text-slate-200">{m.count}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmtCurrency(m.totalValue)}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-500">{fmtCurrency(m.totalValue / Math.max(m.count, 1))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

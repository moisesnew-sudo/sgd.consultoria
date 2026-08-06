import { useState, useEffect, useCallback } from 'react';
import {
  Shield, LogIn, AlertTriangle, Users, PlusCircle, Trash2, ShieldOff, UserCog,
  RefreshCw, Download, Activity, AlertCircle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import { auditApi } from '../../services/api';
import { Kpi } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { Skeleton } from '../ui/Skeleton';
import AuditTimeline from '../shared/AuditTimeline';

const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function AuditDashboardView() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {};
      if (dateRange.start) params.start_date = dateRange.start;
      if (dateRange.end) params.end_date = dateRange.end;
      setStats(await auditApi.getDashboardStats(params));
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar os indicadores de auditoria.');
    }
    finally { setLoading(false); }
  }, [dateRange]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel de Auditoria"
        subtitle="Indicadores e timeline de atividades do sistema"
        icon={<Shield className="text-brand-600" />}
        actions={
          <div className="flex items-center gap-2">
            <input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              aria-label="Data inicial"
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200" />
            <input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              aria-label="Data final"
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200" />
            <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer" title="Atualizar indicadores" aria-label="Atualizar indicadores">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 rounded-xl text-xs font-semibold flex items-center gap-2" role="alert">
          <AlertCircle size={16} /> {error}
          <button onClick={load} className="ml-auto text-[11px] font-bold underline hover:text-rose-700 dark:hover:text-rose-200">Tentar novamente</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
          </div>
        </div>
      ) : stats ? (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Kpi icon={<AlertTriangle size={20} />} label="Falhas de Login" value={String(stats.failed_logins)} accent="rose" />
            <Kpi icon={<Users size={20} />} label="Usuários Ativos" value={String(stats.active_users)} accent="green" />
            <Kpi icon={<LogIn size={20} />} label="Sessões Ativas" value={String(stats.active_sessions)} accent="blue" />
            <Kpi icon={<PlusCircle size={20} />} label="Demandas Criadas" value={String(stats.demands_created)} accent="green" />
            <Kpi icon={<Trash2 size={20} />} label="Demandas Excluídas" value={String(stats.demands_deleted)} accent="rose" />
            <Kpi icon={<ShieldOff size={20} />} label="Alt. Permissões" value={String(stats.permission_changes)} accent="green" />
            <Kpi icon={<UserCog size={20} />} label="Alt. Usuários" value={String(stats.user_changes)} accent="amber" />
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Logins by Day */}
            {stats.logins_by_day?.length > 0 && (
              <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <LogIn size={14} className="text-indigo-500" /> Logins por Dia
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={[...stats.logins_by_day].reverse()}>
                    <defs>
                      <linearGradient id="loginGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => new Date(String(v)).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} width={30} />
                    <Tooltip labelFormatter={v => new Date(String(v)).toLocaleDateString('pt-BR')} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#loginGrad)" name="Logins" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Demands Modified by Day */}
            {stats.demands_modified?.length > 0 && (
              <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Activity size={14} className="text-emerald-500" /> Demandas Modificadas
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[...stats.demands_modified].reverse()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => new Date(String(v)).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} width={30} />
                    <Tooltip labelFormatter={v => new Date(String(v)).toLocaleDateString('pt-BR')} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Modificações" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Changes by User */}
            {stats.changes_by_user?.length > 0 && (
              <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Users size={14} className="text-violet-500" /> Top Usuários por Atividade
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.changes_by_user} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <YAxis type="category" dataKey="user_name" tick={{ fontSize: 9, fill: '#94a3b8' }} width={100} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Ações" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Exports by Day */}
            {stats.exports_done?.length > 0 && (
              <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Download size={14} className="text-cyan-500" /> Exportações por Dia
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[...stats.exports_done].reverse()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => new Date(String(v)).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} width={30} />
                    <Tooltip labelFormatter={v => new Date(String(v)).toLocaleDateString('pt-BR')} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Exportações" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Login vs Failed Pie */}
            {(stats.total_logins > 0 || stats.failed_logins > 0) && (
              <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Shield size={14} className="text-amber-500" /> Status de Login
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Sucesso', value: stats.total_logins },
                        { name: 'Falha', value: stats.failed_logins },
                      ].filter(d => d.value > 0)}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                      paddingAngle={4} dataKey="value"
                    >
                      {[0, 1].map(i => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Users vs Sessions */}
            {(stats.active_users > 0 || stats.active_sessions > 0) && (
              <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Users size={14} className="text-blue-500" /> Usuários vs Sessões
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Usuários Ativos', value: stats.active_users },
                        { name: 'Sessões Ativas', value: stats.active_sessions },
                      ].filter(d => d.value > 0)}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                      paddingAngle={4} dataKey="value"
                    >
                      {[0, 1].map(i => <Cell key={i} fill={PIE_COLORS[i + 2]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Timeline */}
          <AuditTimeline embedded compact maxItems={30} />
        </>
      ) : error ? null : (
        <p className="text-sm text-slate-400 italic">Não foi possível carregar os dados.</p>
      )}
    </div>
  );
}

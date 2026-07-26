import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Shield, LogIn, AlertTriangle, Users, FileText, FileSpreadsheet, PlusCircle, Edit3, Trash2, ShieldOff, UserCog, RefreshCw } from 'lucide-react';
import { auditApi } from '../services/api';
import { Card, Kpi } from './ui/Card';
import { Skeleton } from './ui/Skeleton';

export default function AuditDashboardView() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (dateRange.start) params.start_date = dateRange.start;
      if (dateRange.end) params.end_date = dateRange.end;
      setStats(await auditApi.getDashboardStats(params));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [dateRange]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Shield className="text-brand-600" /> Dashboard de Auditoria
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Indicadores e gráficos de auditoria do sistema</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs" />
          <input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs" />
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi icon={<LogIn size={20} />} label="Total de Logins" value={String(stats.total_logins)} accent="blue" />
            <Kpi icon={<AlertTriangle size={20} />} label="Falhas de Login" value={String(stats.failed_logins)} accent="rose" />
            <Kpi icon={<Users size={20} />} label="Usuários Ativos" value={String(stats.active_users)} accent="green" />
            <Kpi icon={<Users size={20} />} label="Sessões Ativas" value={String(stats.active_sessions)} accent="blue" />
            <Kpi icon={<FileText size={20} />} label="Exportações PDF" value={String(stats.pdf_exports)} accent="green" />
            <Kpi icon={<FileSpreadsheet size={20} />} label="Exportações Excel" value={String(stats.excel_exports)} accent="green" />
            <Kpi icon={<PlusCircle size={20} />} label="Demandas Criadas" value={String(stats.demands_created)} accent="green" />
            <Kpi icon={<Edit3 size={20} />} label="Demandas Alteradas" value={String(stats.demands_updated)} accent="amber" />
            <Kpi icon={<Trash2 size={20} />} label="Demandas Excluídas" value={String(stats.demands_deleted)} accent="rose" />
            <Kpi icon={<ShieldOff size={20} />} label="Alt. Permissões" value={String(stats.permission_changes)} accent="green" />
            <Kpi icon={<UserCog size={20} />} label="Alt. Usuários" value={String(stats.user_changes)} accent="amber" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Logins por Dia">
              {stats.logins_by_day?.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={stats.logins_by_day}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-slate-400 italic">Nenhum dado no período</p>}
            </Card>

            <Card title="Alterações por Usuário">
              {stats.changes_by_user?.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.changes_by_user} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="user_name" tick={{ fontSize: 10 }} width={80} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#059669" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-slate-400 italic">Nenhum dado no período</p>}
            </Card>

            <Card title="Demandas Modificadas">
              {stats.demands_modified?.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.demands_modified}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-slate-400 italic">Nenhum dado no período</p>}
            </Card>

            <Card title="Exportações Realizadas">
              {stats.exports_done?.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={stats.exports_done}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-slate-400 italic">Nenhum dado no período</p>}
            </Card>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400 italic">Não foi possível carregar os dados.</p>
      )}
    </div>
  );
}

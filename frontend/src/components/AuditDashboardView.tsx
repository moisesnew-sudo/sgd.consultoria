import React, { useState, useEffect, useCallback } from 'react';
import { Shield, LogIn, AlertTriangle, Users, PlusCircle, Trash2, ShieldOff, UserCog, RefreshCw } from 'lucide-react';
import { auditApi } from '../services/api';
import { Kpi } from './ui/Card';
import { Skeleton } from './ui/Skeleton';
import AuditTrail from './AuditTrail';

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
            <Shield className="text-brand-600" /> Auditoria
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Rastreabilidade das ações e histórico do sistema</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200" />
          <input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200" />
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300" title="Atualizar indicadores">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Kpi icon={<AlertTriangle size={20} />} label="Falhas de Login" value={String(stats.failed_logins)} accent="rose" />
            <Kpi icon={<Users size={20} />} label="Usuários Ativos" value={String(stats.active_users)} accent="green" />
            <Kpi icon={<LogIn size={20} />} label="Sessões Ativas" value={String(stats.active_sessions)} accent="blue" />
            <Kpi icon={<PlusCircle size={20} />} label="Demandas Criadas" value={String(stats.demands_created)} accent="green" />
            <Kpi icon={<Trash2 size={20} />} label="Demandas Excluídas" value={String(stats.demands_deleted)} accent="rose" />
            <Kpi icon={<ShieldOff size={20} />} label="Alt. Permissões" value={String(stats.permission_changes)} accent="green" />
            <Kpi icon={<UserCog size={20} />} label="Alt. Usuários" value={String(stats.user_changes)} accent="amber" />
          </div>

          <AuditTrail />
        </>
      ) : (
        <p className="text-sm text-slate-400 italic">Não foi possível carregar os dados.</p>
      )}
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Users, Database, FileText, HardDrive, Download, Activity, RefreshCw, UserCheck, UserX, Clock, Archive } from 'lucide-react';
import { lgpdApi } from '../services/api';
import { Card, Kpi } from './ui/Card';
import { Skeleton } from './ui/Skeleton';

export default function LgpdView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await lgpdApi.dashboard()); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Shield className="text-brand-600" /> Conformidade LGPD
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Painel de conformidade com a Lei Geral de Proteção de Dados</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi icon={<Users size={20} />} label="Total de Usuários" value={String(data.users?.total || 0)} accent="blue" />
            <Kpi icon={<UserCheck size={20} />} label="Usuários Ativos" value={String(data.users?.active || 0)} accent="green" />
            <Kpi icon={<Database size={20} />} label="Logs de Auditoria" value={String(data.data_stored?.audit_logs || 0)} accent="green" />
            <Kpi icon={<Activity size={20} />} label="Sessões Ativas" value={String(data.data_stored?.sessions_active || 0)} accent="blue" />
            <Kpi icon={<FileText size={20} />} label="Exportações" value={String(data.data_stored?.exports || 0)} accent="amber" />
            <Kpi icon={<Archive size={20} />} label="Backups" value={String(data.backups?.total || 0)} accent="green" />
            <Kpi icon={<HardDrive size={20} />} label="Permissões" value={String(data.data_stored?.permissions || 0)} accent="green" />
            <Kpi icon={<Download size={20} />} label="Perm. de Usuário" value={String(data.data_stored?.user_permissions || 0)} accent="amber" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Usuários por Perfil">
              {data.users?.by_role ? (
                <div className="space-y-3">
                  {Object.entries(data.users.by_role).map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between">
                      <span className="text-sm capitalize text-slate-600 dark:text-slate-300">
                        {role === 'admin' ? 'Administrador' : role === 'gestor' ? 'Gestor' : role === 'analista' ? 'Analista' : 'Consulta'}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="w-32 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${(count as number / data.users.total) * 100}%` }} />
                        </div>
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{count as number}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-400 italic">Nenhum dado</p>}
            </Card>

            <Card title="Dados Armazenados">
              <div className="space-y-3">
                {[
                  { label: 'Logs de Auditoria', value: data.data_stored?.audit_logs || 0, color: 'bg-purple-500' },
                  { label: 'Permissões', value: data.data_stored?.permissions || 0, color: 'bg-rose-500' },
                  { label: 'Permissões de Usuário', value: data.data_stored?.user_permissions || 0, color: 'bg-orange-500' },
                  { label: 'Exportações', value: data.data_stored?.exports || 0, color: 'bg-amber-500' },
                  { label: 'Sessões Ativas', value: data.data_stored?.sessions_active || 0, color: 'bg-indigo-500' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-300">{item.label}</span>
                    <span className="text-sm font-bold">{item.value}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Acessos">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Último Acesso</span>
                  <span className="font-medium">{data.access?.last_access ? new Date(data.access.last_access).toLocaleString('pt-BR') : 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Início Retenção</span>
                  <span className="font-medium">{data.access?.data_retention_start ? new Date(data.access.data_retention_start).toLocaleString('pt-BR') : 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Fim Retenção</span>
                  <span className="font-medium">{data.access?.data_retention_end ? new Date(data.access.data_retention_end).toLocaleString('pt-BR') : 'N/A'}</span>
                </div>
              </div>
            </Card>

            <Card title="Backups e Exportações">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total de Backups</span>
                  <span className="font-bold">{data.backups?.total || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Último Backup</span>
                  <span className="font-medium">{data.backups?.last_backup ? new Date(data.backups.last_backup).toLocaleString('pt-BR') : 'Nenhum'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Exportações PDF</span>
                  <span className="font-bold">{data.exports?.pdf || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Exportações Excel</span>
                  <span className="font-bold">{data.exports?.excel || 0}</span>
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400 italic">Não foi possível carregar os dados de conformidade LGPD.</p>
      )}
    </div>
  );
}

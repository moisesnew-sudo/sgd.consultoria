import React, { useState, useEffect } from 'react';
import { ScrollText, RefreshCw, Filter } from 'lucide-react';
import { auditApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../services/api';
import { TableSkeleton } from './ui/Skeleton';

interface AuditRow {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  user_name: string;
  details: any;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Criação',
  update: 'Edição',
  delete: 'Exclusão',
  comment: 'Comentário',
  login: 'Login',
};

export default function AuditView() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<'all' | 'demand'>('all');

  const load = async () => {
    setLoading(true);
    try {
      const data = await auditApi.list({
        entity_type: entity === 'all' ? undefined : entity,
        limit: 200,
      });
      setLogs(data);
    } catch (e) {
      console.error('Audit load error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [entity]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <ScrollText className="text-emerald-600" /> Trilha de Auditoria
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Registro imutável de todas as ações no sistema</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-slate-400" />
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value as any)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="all">Todos os tipos</option>
              <option value="demand">Demandas</option>
            </select>
          </div>
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800" title="Atualizar">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 text-left text-[10px] uppercase font-bold text-slate-500">
                  <th className="px-4 py-3">Data/Hora</th>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Ação</th>
                  <th className="px-4 py-3">Entidade</th>
                  <th className="px-4 py-3">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200">{log.user_name}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-bold uppercase">
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-slate-500">{log.entity_type}/{log.entity_id}</td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-500 max-w-xs truncate">
                      {log.details ? JSON.stringify(log.details) : '—'}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400 italic">Nenhum registro de auditoria.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

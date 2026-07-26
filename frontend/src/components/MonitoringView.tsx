import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Server, Database, Wifi, MemoryStick, Cpu, Clock, Users, HardDrive, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { monitoringApi } from '../services/api';
import { Card, Kpi } from './ui/Card';
import { Skeleton } from './ui/Skeleton';

export default function MonitoringView() {
  const [health, setHealth] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, hist] = await Promise.all([
        monitoringApi.health(),
        monitoringApi.history(24)
      ]);
      setHealth(h);
      setHistory(hist);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusBadge = (status: string) => {
    if (status === 'online') return <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle size={12} /> Online</span>;
    if (status === 'slow') return <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle size={12} /> Lento</span>;
    return <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertTriangle size={12} /> Offline</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="text-brand-600" /> Monitoramento
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Saúde do sistema em tempo real</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800" title="Atualizar">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : health ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card title="Servidor">
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Status</span>{statusBadge(health.server.status)}</div>
                <div className="flex justify-between"><span className="text-slate-500">Uptime</span><span className="font-medium">{health.server.uptime}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">CPU Cores</span><span className="font-medium">{health.server.cpu_cores}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">RAM</span><span className="font-medium">{health.server.memory_usage_percent}% ({health.server.free_memory_gb}GB livre / {health.server.total_memory_gb}GB)</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Plataforma</span><span className="font-medium">{health.server.platform}</span></div>
              </div>
            </Card>

            <Card title="Banco de Dados">
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Status</span>{statusBadge(health.database.status)}</div>
                <div className="flex justify-between"><span className="text-slate-500">Tempo de Resposta</span><span className="font-medium">{health.database.response_time_ms}ms</span></div>
              </div>
            </Card>

            <Card title="API">
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Status</span>{statusBadge(health.api.status)}</div>
                <div className="flex justify-between"><span className="text-slate-500">Tempo de Resposta</span><span className="font-medium">{health.api.response_time_ms}ms</span></div>
              </div>
            </Card>

            <Card title="Usuários">
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Conectados</span><span className="font-bold text-lg">{health.app.active_users}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Total Demandas</span><span className="font-bold text-lg">{health.app.total_demands}</span></div>
              </div>
            </Card>

            <Card title="Backup">
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Último Backup</span><span className="font-medium">{health.app.last_backup ? new Date(health.app.last_backup).toLocaleString('pt-BR') : 'Nenhum'}</span></div>
              </div>
            </Card>

            <Card title="Integrações">
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Req. 24h</span><span className="font-medium">{health.app.integrations_24h}</span></div>
              </div>
            </Card>
          </div>

          {history.length > 0 && (
            <Card title="Histórico de Monitoramento (últimas 24h)">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-left text-[10px] uppercase font-bold text-slate-500">
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">CPU</th>
                      <th className="px-3 py-2">RAM</th>
                      <th className="px-3 py-2">API (ms)</th>
                      <th className="px-3 py-2">Usuários</th>
                      <th className="px-3 py-2">Demandas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {history.map((h: any) => (
                      <tr key={h.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        <td className="px-3 py-2">{new Date(h.recorded_at).toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2">{h.server_cpu?.toFixed(1)}</td>
                        <td className="px-3 py-2">{h.server_memory?.toFixed(1)}%</td>
                        <td className="px-3 py-2">{h.api_response_time}ms</td>
                        <td className="px-3 py-2">{h.active_users}</td>
                        <td className="px-3 py-2">{h.total_demands}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-400 italic">Não foi possível carregar dados de monitoramento.</p>
      )}
    </div>
  );
}

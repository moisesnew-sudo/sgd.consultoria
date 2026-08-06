import { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import { monitoringApi } from '../../services/api';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { Skeleton } from '../ui/Skeleton';
import { Table, TableHead, TableBody, TableEmpty, Th, Tr, Td } from '../ui/Table';

export default function MonitoringView() {
  const [health, setHealth] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, hist] = await Promise.all([
        monitoringApi.health(),
        monitoringApi.history(24)
      ]);
      setHealth(h);
      setHistory(hist);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar dados de monitoramento.');
    }
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
      <PageHeader
        title="Monitoramento"
        subtitle="Saúde do sistema em tempo real"
        icon={<Activity className="text-brand-600" />}
        actions={
          <button onClick={load} aria-label="Atualizar dados de monitoramento" className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" title="Atualizar">
            <RefreshCw size={16} />
          </button>
        }
      />

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 rounded-xl text-xs font-semibold flex items-center gap-2" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      )}

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

          <Card title="Histórico de Monitoramento (últimas 24h)">
            <Table minWidth={640}>
              <TableHead>
                <Th>Data</Th>
                <Th>CPU</Th>
                <Th>RAM</Th>
                <Th>API (ms)</Th>
                <Th>Usuários</Th>
                <Th>Demandas</Th>
              </TableHead>
              <TableBody>
                {history.length === 0 && <TableEmpty colSpan={6} message="Nenhum registro de monitoramento nas últimas 24h." />}
                {history.map((h: any) => (
                  <Tr key={h.id}>
                    <Td><span className="text-xs">{new Date(h.recorded_at).toLocaleString('pt-BR')}</span></Td>
                    <Td><span className="text-xs">{h.server_cpu?.toFixed(1)}</span></Td>
                    <Td><span className="text-xs">{h.server_memory?.toFixed(1)}%</span></Td>
                    <Td><span className="text-xs">{h.api_response_time}ms</span></Td>
                    <Td><span className="text-xs">{h.active_users}</span></Td>
                    <Td><span className="text-xs">{h.total_demands}</span></Td>
                  </Tr>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      ) : null}
    </div>
  );
}

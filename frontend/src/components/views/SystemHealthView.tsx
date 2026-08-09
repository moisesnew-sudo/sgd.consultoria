import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, RefreshCw, AlertTriangle, CheckCircle, AlertCircle, Clock, Zap, Radio, Tv, Bell, Activity } from 'lucide-react';
import { monitoringApi } from '../../services/api';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { Skeleton } from '../ui/Skeleton';
import type { SystemHealthResponse, ComponentStatus, SystemHealthAlert } from '../../types';

const POLL_INTERVAL_MS = 30_000;

function statusColor(s: ComponentStatus): string {
  if (s === 'ok') return 'text-emerald-600 dark:text-emerald-400';
  if (s === 'degraded') return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function statusDot(s: ComponentStatus): string {
  if (s === 'ok') return 'bg-emerald-500';
  if (s === 'degraded') return 'bg-amber-500';
  return 'bg-red-500';
}

function statusLabel(s: ComponentStatus): string {
  if (s === 'ok') return 'Operacional';
  if (s === 'degraded') return 'Degradado';
  return 'Indisponível';
}

function severityBadge(severity: string) {
  if (severity === 'critical') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Crítico</span>;
  if (severity === 'warning') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Alerta</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Info</span>;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}min`;
  return `${Math.floor(ms / 3600_000)}h ${Math.floor((ms % 3600_000) / 60_000)}min`;
}

function ComponentRow({ label, status, children }: { label: string; status: ComponentStatus; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(status)}`} />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{children}</div>
    </div>
  );
}

function AlertRow({ alert }: { alert: SystemHealthAlert }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
      {severityBadge(alert.severity)}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{alert.message || alert.type}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {new Date(alert.createdAt).toLocaleString('pt-BR')} · {formatDuration(alert.durationMs)}
        </p>
      </div>
      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
        alert.status === 'open'
          ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
          : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
      }`}>
        {alert.status === 'open' ? 'Aberto' : 'Reconhecido'}
      </span>
    </div>
  );
}

export default function SystemHealthView() {
  const [data, setData] = useState<SystemHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await monitoringApi.systemHealth();
      setData(res);
      setLastUpdate(new Date());
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar dados de saúde do sistema.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saúde do Sistema"
        subtitle="Dashboard operacional de componentes críticos"
        icon={<Shield className="text-brand-600" />}
        actions={
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Atualizado {lastUpdate.toLocaleTimeString('pt-BR')}
              </span>
            )}
            <button onClick={load} aria-label="Atualizar dados" className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" title="Atualizar">
              <RefreshCw size={16} />
            </button>
          </div>
        }
      />

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 rounded-xl text-xs font-semibold flex items-center gap-2" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
      ) : data ? (
        <>
          {/* Overall status banner */}
          <div className={`flex items-center gap-3 p-4 rounded-2xl border ${
            data.status === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40'
              : data.status === 'degraded'
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40'
          }`}>
            <span className={`w-3 h-3 rounded-full ${statusDot(data.status)}`} />
            <div>
              <p className={`text-sm font-bold ${statusColor(data.status)}`}>
                Sistema {statusLabel(data.status)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Uptime: {Math.floor(data.uptime / 3600)}h {Math.floor((data.uptime % 3600) / 60)}min · v{data.version}
              </p>
            </div>
            {data.alerts.total > 0 && (
              <div className="ml-auto flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Bell size={14} />
                <span className="text-xs font-bold">{data.alerts.total} alerta{data.alerts.total > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Component cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* PostgreSQL */}
            <Card title="Banco de Dados" subtitle="PostgreSQL" icon={<Zap size={18} />}>
              <div className="p-5 space-y-0">
                <ComponentRow label="Status" status={data.database.status}>
                  <span className={`font-bold ${statusColor(data.database.status)}`}>{statusLabel(data.database.status)}</span>
                </ComponentRow>
                <ComponentRow label="Conexões" status={data.database.status}>
                  <span>{data.database.totalConnections} total · {data.database.idleConnections} livres</span>
                </ComponentRow>
                <ComponentRow label="Aguardando" status={data.database.waitingClients > 5 ? 'degraded' : 'ok'}>
                  <span>{data.database.waitingClients} clientes</span>
                </ComponentRow>
              </div>
            </Card>

            {/* PostgreSQL Listener */}
            <Card title="PostgreSQL Listener" subtitle="LISTEN/NOTIFY" icon={<Radio size={18} />}>
              <div className="p-5 space-y-0">
                <ComponentRow label="Conectado" status={data.postgresListener.status}>
                  <span className={`font-bold ${data.postgresListener.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {data.postgresListener.connected ? 'Sim' : 'Não'}
                  </span>
                </ComponentRow>
                <ComponentRow label="Última notificação" status="ok">
                  <span>{data.postgresListener.lastNotificationAt ? new Date(data.postgresListener.lastNotificationAt).toLocaleTimeString('pt-BR') : 'Nenhuma'}</span>
                </ComponentRow>
                <ComponentRow label="Reconexões" status={data.postgresListener.reconnectCount > 5 ? 'degraded' : 'ok'}>
                  <span>{data.postgresListener.reconnectCount}</span>
                </ComponentRow>
              </div>
            </Card>

            {/* Event Bus */}
            <Card title="Event Bus" subtitle="EventEmitter" icon={<Activity size={18} />}>
              <div className="p-5 space-y-0">
                <ComponentRow label="Status" status={data.eventBus.status}>
                  <span className={`font-bold ${statusColor(data.eventBus.status)}`}>{statusLabel(data.eventBus.status)}</span>
                </ComponentRow>
                <ComponentRow label="Publicados" status="ok">
                  <span>{data.eventBus.eventsPublished}</span>
                </ComponentRow>
                <ComponentRow label="Recebidos" status="ok">
                  <span>{data.eventBus.eventsReceived}</span>
                </ComponentRow>
                <ComponentRow label="Erros" status={data.eventBus.errors > 100 ? 'degraded' : 'ok'}>
                  <span>{data.eventBus.errors}</span>
                </ComponentRow>
                <ComponentRow label="Listeners" status="ok">
                  <span>{data.eventBus.activeListeners}</span>
                </ComponentRow>
              </div>
            </Card>

            {/* SSE */}
            <Card title="SSE" subtitle="Server-Sent Events" icon={<Tv size={18} />}>
              <div className="p-5 space-y-0">
                <ComponentRow label="Status" status={data.sse.status}>
                  <span className={`font-bold ${statusColor(data.sse.status)}`}>{statusLabel(data.sse.status)}</span>
                </ComponentRow>
                <ComponentRow label="Conexões ativas" status="ok">
                  <span>{data.sse.activeConnections}</span>
                </ComponentRow>
                <ComponentRow label="Eventos enviados" status="ok">
                  <span>{data.sse.eventsSent}</span>
                </ComponentRow>
                <ComponentRow label="Erros" status={data.sse.errors > 50 ? 'degraded' : 'ok'}>
                  <span>{data.sse.errors}</span>
                </ComponentRow>
              </div>
            </Card>

            {/* Scheduler */}
            <Card title="Alert Scheduler" subtitle="Avaliação periódica" icon={<Clock size={18} />}>
              <div className="p-5 space-y-0">
                <ComponentRow label="Ativo" status={data.scheduler.active ? 'ok' : 'down'}>
                  <span className={`font-bold ${data.scheduler.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {data.scheduler.active ? 'Sim' : 'Não'}
                  </span>
                </ComponentRow>
                <ComponentRow label="Última execução" status="ok">
                  <span>{data.scheduler.lastRunAt ? new Date(data.scheduler.lastRunAt).toLocaleTimeString('pt-BR') : 'Nenhuma'}</span>
                </ComponentRow>
                <ComponentRow label="Duração" status="ok">
                  <span>{data.scheduler.lastDurationMs != null ? `${data.scheduler.lastDurationMs}ms` : '—'}</span>
                </ComponentRow>
                <ComponentRow label="Último erro" status={data.scheduler.lastError ? 'degraded' : 'ok'}>
                  <span className="truncate max-w-[120px]">{data.scheduler.lastError || 'Nenhum'}</span>
                </ComponentRow>
              </div>
            </Card>

            {/* Alerts summary card */}
            <Card title="Alertas" subtitle="Operacionais" icon={<AlertTriangle size={18} />}>
              <div className="p-5 space-y-0">
                <ComponentRow label="Abertos" status={data.alerts.openCount > 0 ? 'degraded' : 'ok'}>
                  <span className="font-bold">{data.alerts.openCount}</span>
                </ComponentRow>
                <ComponentRow label="Reconhecidos" status="ok">
                  <span>{data.alerts.acknowledgedCount}</span>
                </ComponentRow>
                <ComponentRow label="Total ativos" status={data.alerts.total > 0 ? 'degraded' : 'ok'}>
                  <span className="font-bold">{data.alerts.total}</span>
                </ComponentRow>
              </div>
            </Card>
          </div>

          {/* Active alerts list */}
          {data.alerts.items.length > 0 && (
            <Card title="Alertas Ativos" subtitle={`${data.alerts.total} alerta${data.alerts.total > 1 ? 's' : ''} operacional${data.alerts.total > 1 ? 'is' : ''}`} icon={<Bell size={18} />}>
              <div className="p-5">
                {data.alerts.items.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} />
                ))}
              </div>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

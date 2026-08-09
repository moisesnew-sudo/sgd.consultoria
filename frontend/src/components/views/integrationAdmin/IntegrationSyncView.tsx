import { CheckCircle2, AlertTriangle, AlertOctagon, Clock, Server, RefreshCw, Play, Pause, Calendar, Timer, Activity, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Skeleton } from '../../ui/Skeleton';
import { Table, TableHead, TableBody, Th, Tr, Td } from '../../ui/Table';
import { Card, Kpi } from '../../ui/Card';
import { PageHeader } from '../../ui/PageHeader';
import { Button } from '../../ui/Button';
import { Alert } from '../../ui/Alert';
import { formatDateShort, integrationAdminApi } from '../../../services/api';
import type { SyncStatusData, SyncStatusSystem } from '../../../types';

const HEALTH_STATUS_CONFIG = {
  operational: { label: 'Operacional', icon: <CheckCircle2 size={12} className="text-emerald-500" />, cls: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' },
  attention: { label: 'Atenção', icon: <AlertTriangle size={12} className="text-amber-500" />, cls: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300' },
  failure: { label: 'Falha', icon: <AlertOctagon size={12} className="text-rose-500" />, cls: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300' },
};

interface SyncViewProps {
  onRefresh?: () => void;
}

function TableSkeleton() {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, i) => (
        <Tr key={i}>
          <Td><Skeleton className="h-5 w-24" /></Td>
          <Td><Skeleton className="h-6 w-20" /></Td>
          <Td><Skeleton className="h-5 w-16" /></Td>
          <Td><Skeleton className="h-5 w-28" /></Td>
          <Td><Skeleton className="h-5 w-28" /></Td>
          <Td><Skeleton className="h-5 w-20" /></Td>
          <Td><Skeleton className="h-5 w-12" /></Td>
        </Tr>
      ))}
    </TableBody>
  );
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function SchedulerStatus({ running, lastCycleAt }: { running: boolean; lastCycleAt: string | null }) {
  return (
    <div className="flex items-center gap-2">
      {running ? (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300">
          <Play size={10} className="shrink-0" />
          Executando
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
          <Pause size={10} className="shrink-0" />
          Parado
        </span>
      )}
      {lastCycleAt && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Último ciclo: {formatDateShort(lastCycleAt)}
        </span>
      )}
    </div>
  );
}

export default function IntegrationSyncView({ onRefresh }: SyncViewProps) {
  const [syncData, setSyncData] = useState<SyncStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await integrationAdminApi.getSyncStatus();
      setSyncData(data);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar status de sincronização');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = () => {
    load();
    onRefresh?.();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Sincronização Periódica"
          subtitle="Status da sincronização automática com sistemas governamentais"
          icon={<Activity size={24} className="text-gov-700 dark:text-gov-300" />}
          actions={
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              Atualizar
            </Button>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-24" count={4} />
        </div>
        <div className="overflow-x-auto">
          <Table minWidth={900}>
            <TableHead>
              <Th>Sistema</Th>
              <Th>Status</Th>
              <Th>Intervalo</Th>
              <Th>Última Sync</Th>
              <Th>Próxima Sync</Th>
              <Th>Erros (24h)</Th>
              <Th>Falhas Consecutivas</Th>
            </TableHead>
            <TableSkeleton />
          </Table>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Sincronização Periódica"
          subtitle="Status da sincronização automática com sistemas governamentais"
          icon={<Activity size={24} className="text-gov-700 dark:text-gov-300" />}
          actions={
            <Button variant="primary" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              Tentar novamente
            </Button>
          }
        />
        <Alert variant="danger" title="Erro ao carregar" onClose={handleRefresh}>
          {error}
        </Alert>
      </div>
    );
  }

  if (!syncData || !syncData.systems.length) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Sincronização Periódica"
          subtitle="Status da sincronização automática com sistemas governamentais"
          icon={<Activity size={24} className="text-gov-700 dark:text-gov-300" />}
          actions={
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              Atualizar
            </Button>
          }
        />
        <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-12 text-center">
          <p className="text-slate-500 dark:text-slate-400">Nenhum sistema de integração configurado.</p>
        </div>
      </div>
    );
  }

  const { systems, summary, scheduler } = syncData;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sincronização Periódica"
        subtitle="Status da sincronização automática com sistemas governamentais"
        icon={<Activity size={24} className="text-gov-700 dark:text-gov-300" />}
        actions={
          <div className="flex items-center gap-2">
            <SchedulerStatus running={scheduler.running} lastCycleAt={scheduler.lastCycleAt} />
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              Atualizar
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Total de Sistemas"
          value={String(summary.total)}
          icon={<Server size={20} />}
          accent="gov"
        />
        <Kpi
          label="Sync Habilitada"
          value={String(summary.syncEnabled)}
          icon={<Play size={20} />}
          accent="blue"
        />
        <Kpi
          label="Saudáveis"
          value={String(summary.healthy)}
          icon={<CheckCircle2 size={20} />}
          accent="green"
        />
        <Kpi
          label="Com Problemas"
          value={String(summary.warning + summary.failed)}
          icon={summary.failed > 0 ? <AlertOctagon size={20} /> : <AlertTriangle size={20} />}
          accent={summary.failed > 0 ? 'rose' : 'amber'}
        />
      </div>

      <Card
        title="Sistemas de Sincronização"
        subtitle="Status detalhado de cada sistema com sincronização periódica"
        icon={<Timer size={20} />}
      >
        <div className="overflow-x-auto">
          <Table minWidth={900}>
            <TableHead>
              <Th>Sistema</Th>
              <Th>Status</Th>
              <Th>Intervalo</Th>
              <Th>Última Sync</Th>
              <Th>Próxima Sync</Th>
              <Th>Erros (24h)</Th>
              <Th>Falhas Consecutivas</Th>
            </TableHead>
            <TableBody>
              {systems.map((system) => {
                const statusConfig = HEALTH_STATUS_CONFIG[system.healthStatus];
                return (
                  <Tr key={system.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                          system.syncEnabled 
                            ? 'bg-gov-100 dark:bg-gov-900/40 text-gov-700 dark:text-gov-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        }`}>
                          <Server size={16} />
                        </div>
                        <div>
                          <p className="font-extrabold text-slate-800 dark:text-white">{system.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{system.code}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusConfig.cls}`}>
                          {statusConfig.icon}
                          {statusConfig.label}
                        </span>
                        {!system.active && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            Inativo
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {system.syncEnabled ? formatInterval(system.syncIntervalMinutes) : '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {system.lastSyncAt ? formatDateShort(system.lastSyncAt) : 'Nunca'}
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {system.nextSyncAt ? formatDateShort(system.nextSyncAt) : '—'}
                      </span>
                    </Td>
                    <Td>
                      <span className={`font-mono text-xs font-bold ${system.errorCount24h > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {system.errorCount24h}
                      </span>
                    </Td>
                    <Td>
                      <span className={`font-mono text-xs font-bold ${system.consecutiveErrors > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {system.consecutiveErrors}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

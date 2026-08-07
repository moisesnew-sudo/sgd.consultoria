import { CheckCircle2, AlertTriangle, AlertOctagon, Clock, Server, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Skeleton } from '../../ui/Skeleton';
import { Table, TableHead, TableBody, TableEmpty, Th, Tr, Td } from '../../ui/Table';
import { Card } from '../../ui/Card';
import { PageHeader } from '../../ui/PageHeader';
import { Button } from '../../ui/Button';
import { Alert } from '../../ui/Alert';
import { formatDateShort } from '../../../services/api';
import { integrationAdminApi } from '../../../services/api';
import type { IntegrationHealth } from '../../../types';

const HEALTH_STATUS_CONFIG = {
  operational: { label: 'Operacional', icon: <CheckCircle2 size={12} className="text-emerald-500" />, cls: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' },
  attention: { label: 'Atenção', icon: <AlertTriangle size={12} className="text-amber-500" />, cls: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300' },
  failure: { label: 'Falha', icon: <AlertOctagon size={12} className="text-rose-500" />, cls: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300' },
};

interface HealthTableProps {
  onRefresh?: () => void;
}

function TableSkeleton() {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, i) => (
        <Tr key={i}>
          <Td><Skeleton className="h-5 w-24" /></Td>
          <Td><Skeleton className="h-6 w-20" /></Td>
          <Td><Skeleton className="h-5 w-28" /></Td>
          <Td><Skeleton className="h-5 w-20" /></Td>
          <Td><Skeleton className="h-5 w-20" /></Td>
          <Td><Skeleton className="h-5 w-12" /></Td>
        </Tr>
      ))}
    </TableBody>
  );
}

export default function IntegrationHealthTable({ onRefresh }: { onRefresh?: () => void }) {
  const [health, setHealth] = useState<IntegrationHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await integrationAdminApi.getHealth();
      setHealth(data);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar saúde dos sistemas');
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
          title="Saúde dos Sistemas"
          subtitle="Status de saúde de cada sistema de integração"
          icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
          actions={
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              Atualizar
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <Table minWidth={720}>
            <TableHead>
              <Th>Nome</Th>
              <Th>Status</Th>
              <Th>Última sincronização</Th>
              <Th>HTTP Status</Th>
              <Th>Tempo resposta</Th>
              <Th>Falhas</Th>
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
          title="Saúde dos Sistemas"
          subtitle="Status de saúde de cada sistema de integração"
          icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
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

  if (!health.length) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Saúde dos Sistemas"
          subtitle="Status de saúde de cada sistema de integração"
          icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Saúde dos Sistemas"
        subtitle="Status de saúde de cada sistema de integração"
        icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
            Atualizar
          </Button>
        }
      />
      <div className="overflow-x-auto">
        <Table minWidth={720}>
          <TableHead>
            <Th>Nome</Th>
            <Th>Status</Th>
            <Th>Última sincronização</Th>
            <Th>HTTP Status</Th>
            <Th>Tempo resposta</Th>
            <Th>Falhas</Th>
          </TableHead>
          <TableBody>
            {health.map((item) => {
              const statusConfig = HEALTH_STATUS_CONFIG[item.status];
              return (
                <Tr key={item.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-gov-100 dark:bg-gov-900/40 text-gov-700 dark:text-gov-300 flex items-center justify-center">
                        <Server size={16} />
                      </div>
                      <div>
                        <p className="font-extrabold text-slate-800 dark:text-white">{item.name}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusConfig.cls}`}>
                      {statusConfig.icon}
                      {statusConfig.label}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {item.lastSync ? formatDateShort(item.lastSync) : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {item.httpStatus !== null ? item.httpStatus : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {item.responseTime !== null ? `${item.responseTime}ms` : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className={`font-mono text-xs font-bold ${item.failures > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {item.failures}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
import { useEffect, useState } from 'react';
import { Server, CheckCircle, XCircle, AlertTriangle, CheckCircle2, AlertOctagon, Clock, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { integrationAdminApi } from '../../services/api';
import { PageHeader } from '../ui/PageHeader';
import { Card, Kpi } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { Alert } from '../ui/Alert';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { formatDateShort } from '../../services/api';
import type { IntegrationDashboard } from '../../types';

const STATUS_LABELS: Record<IntegrationDashboard['status'], { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  healthy: { label: 'Saudável', variant: 'success' },
  warning: { label: 'Atenção', variant: 'warning' },
  critical: { label: 'Crítico', variant: 'danger' },
};

function StatusIndicator({ status }: { status: IntegrationDashboard['status'] }) {
  const { label, variant } = STATUS_LABELS[status];
  const isHealthy = status === 'healthy';
  const isWarning = status === 'warning';

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
      isHealthy ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' :
      isWarning ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300' :
      'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
    }`}>
      {isHealthy && <CheckCircle2 size={10} className="shrink-0" />}
      {isWarning && <AlertTriangle size={10} className="shrink-0" />}
      {!isHealthy && !isWarning && <AlertOctagon size={10} className="shrink-0" />}
      {label}
    </span>
  );
}

function LastUpdateRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
      <Clock size={14} className="shrink-0 text-slate-400" />
      <span className="font-medium text-slate-500 dark:text-slate-400">{label}:</span>
      <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
        {value ? formatDateShort(value) : 'Nenhum erro registrado'}
      </span>
    </div>
  );
}

export default function IntegrationAdminView() {
  const { hasPermission } = useAuth();
  const [dashboard, setDashboard] = useState<IntegrationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canView = hasPermission('integrations.view');

  const fetchDashboard = async () => {
    if (!canView) return;
    try {
      setLoading(true);
      setError(null);
      const data = await integrationAdminApi.getDashboard();
      setDashboard(data);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar o dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [canView]);

  if (!canView) {
    return (
      <Alert variant="danger" title="Acesso negado">
        Você não possui permissão <code className="px-1.5 py-0.5 bg-black/10 dark:bg-white/10 rounded text-xs font-mono">integrations.view</code> para acessar esta página.
      </Alert>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Administração de Integrações"
          subtitle="Monitoramento e gerenciamento dos sistemas integrados ao SGD."
          icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-24" count={4} />
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Administração de Integrações"
          subtitle="Monitoramento e gerenciamento dos sistemas integrados ao SGD."
          icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
        />
        <Alert variant="danger" title="Erro ao carregar" onClose={() => fetchDashboard()}>
          {error}
        </Alert>
        <Button variant="primary" icon={<RefreshCw size={15} />} onClick={fetchDashboard}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Administração de Integrações"
          subtitle="Monitoramento e gerenciamento dos sistemas integrados ao SGD."
          icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
        />
        <EmptyState
          icon={<Server size={48} className="text-slate-300 dark:text-slate-600" />}
          title="Nenhum dado disponível"
          subtitle="O dashboard não retornou informações. Tente atualizar."
        />
        <Button variant="primary" icon={<RefreshCw size={15} />} onClick={fetchDashboard}>
          Atualizar
        </Button>
      </div>
    );
  }

  const statusConfig = STATUS_LABELS[dashboard.status];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administração de Integrações"
        subtitle="Monitoramento e gerenciamento dos sistemas integrados ao SGD."
        icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
        actions={
          <Button variant="outline" icon={<RefreshCw size={15} />} onClick={fetchDashboard}>
            Atualizar
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Total de Sistemas"
          value={String(dashboard.total)}
          icon={<Server size={20} />}
          accent="gov"
        />
        <Kpi
          label="Sistemas Ativos"
          value={String(dashboard.active)}
          icon={<CheckCircle size={20} />}
          accent="green"
        />
        <Kpi
          label="Sistemas Inativos"
          value={String(dashboard.inactive)}
          icon={<XCircle size={20} />}
          accent="amber"
        />
        <Kpi
          label="Falhas últimas 24h"
          value={String(dashboard.failures24h)}
          icon={<AlertTriangle size={20} />}
          accent={dashboard.failures24h > 0 ? 'rose' : 'green'}
          highlight={dashboard.failures24h > 0 ? 'rose' : undefined}
        />
      </div>

      <Card
        title="Status Geral"
        subtitle="Saúde consolidada dos sistemas de integração"
        icon={<CheckCircle2 size={20} />}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <StatusIndicator status={dashboard.status} />
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-white">Status atual:</span>{' '}
              {statusConfig.label}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-700/50">
            <LastUpdateRow label="Última sincronização" value={dashboard.lastSync} />
            <LastUpdateRow label="Último erro" value={dashboard.lastError} />
          </div>
        </div>
      </Card>
    </div>
  );
}
import { useEffect, useState, useCallback } from 'react';
import { X, CheckCircle, XCircle, AlertTriangle, Server, Clock, Database, AlertOctagon, CheckCircle2, Edit, RefreshCw, Activity } from 'lucide-react';
import { Drawer } from '../../ui/Drawer';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { Alert } from '../../ui/Alert';
import { formatDateShort } from '../../../services/api';
import { integrationAdminApi } from '../../../services/api';
import { maskConfigForDisplay } from '../../../lib/integrationConfig';
import type { IntegrationSystemDetail } from '../../../types';

interface IntegrationSystemDrawerProps {
  systemId: number;
  open: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

export default function IntegrationSystemDrawer({ systemId, open, onClose, onRefresh }: IntegrationSystemDrawerProps) {
  const [system, setSystem] = useState<IntegrationSystemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await integrationAdminApi.getSystemDetails(systemId);
      setSystem(data);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar detalhes do sistema');
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    if (open) {
      load();
    } else {
      setSystem(null);
      setLoading(true);
      setError(null);
    }
  }, [open, load]);

  if (loading) {
    return (
      <Drawer open={open} onClose={onClose} title="Detalhes do Sistema" subtitle="Informações completas do sistema de integração">
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-32" />
        </div>
      </Drawer>
    );
  }

  if (error) {
    return (
      <Drawer open={open} onClose={onClose} title="Detalhes do Sistema">
        <div className="space-y-4 p-4">
          <Alert variant="danger" title="Erro ao carregar" onClose={() => {}}>
            {error}
          </Alert>
        </div>
      </Drawer>
    );
  }

  if (!system) {
    return (
      <Drawer open={open} onClose={onClose} title="Detalhes do Sistema">
        <div className="p-4 text-center">
          <p className="text-slate-500 dark:text-slate-400">Nenhum sistema selecionado.</p>
        </div>
      </Drawer>
    );
  }

  const healthStatusConfig = {
    operational: { label: 'Operacional', icon: <CheckCircle2 size={12} className="text-emerald-500" />, cls: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' },
    attention: { label: 'Atenção', icon: <AlertTriangle size={12} className="text-amber-500" />, cls: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300' },
    failure: { label: 'Falha', icon: <AlertOctagon size={12} className="text-rose-500" />, cls: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300' },
  };

  const healthConfig = healthStatusConfig[system.health.status];

  return (
    <Drawer open={open} onClose={onClose} title="Detalhes do Sistema" subtitle={system.name}>
      <div className="space-y-6 p-4">
        {/* Header com status */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">{system.name}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">{system.code}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${system.active
              ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
              {system.active ? 'Ativo' : 'Inativo'}
            </span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${healthConfig.cls}`}>
              {healthConfig.icon}
              {healthConfig.label}
            </span>
          </div>
        </div>

        {/* Informações Gerais */}
        <Card title="Informações Gerais" icon={<Server size={18} />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Código</label>
              <p className="font-mono text-sm text-slate-800 dark:text-white">{system.code}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Descrição</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.description || '—'}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Criado em</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.created_at ? new Date(system.created_at).toLocaleString('pt-BR') : '—'}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Atualizado em</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.updated_at ? new Date(system.updated_at).toLocaleString('pt-BR') : '—'}</p>
            </div>
          </div>
        </Card>

        {/* Saúde do Sistema */}
        <Card title="Saúde do Sistema" icon={<Activity size={18} />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Status</label>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${healthConfig.cls}`}>
                {healthConfig.icon}
                {healthConfig.label}
              </span>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Última Sincronização</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.health.lastSync ? new Date(system.health.lastSync).toLocaleString('pt-BR') : '—'}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Último Erro</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.health.lastError ? new Date(system.health.lastError).toLocaleString('pt-BR') : '—'}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Último HTTP Status</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.health.httpStatus !== null ? system.health.httpStatus : '—'}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Tempo de Resposta</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.health.responseTime !== null ? `${system.health.responseTime}ms` : '—'}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Falhas Consecutivas</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.health.consecutiveErrors}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Erros 24h</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.health.errorCount24h}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Última Mensagem de Erro</label>
              <p className="text-sm text-slate-600 dark:text-slate-300">{system.health.lastErrorMessage || '—'}</p>
            </div>
          </div>
        </Card>

        {/* Configuração (sem segredos) */}
        <Card title="Configuração" subtitle="Apenas dados seguros são exibidos" icon={<Database size={18} />}>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Config JSON</label>
            <pre className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-3 text-xs text-slate-600 dark:text-slate-300 overflow-x-auto max-h-48">
              {system.config ? JSON.stringify(maskConfigForDisplay(system.config), null, 2) : '—'}
            </pre>
          </div>
        </Card>

        {/* Últimos Logs */}
        <Card title="Últimos Eventos" subtitle="Últimos 10 registros de execução" icon={<Clock size={18} />}>
          {system.recentLogs.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Nenhum evento recente.</p>
          ) : (
            <div className="space-y-2">
              {system.recentLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${log.status === 'success' ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' : log.status === 'warning' ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300' : 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'}`}>
                      {log.status === 'success' ? 'Sucesso' : log.status === 'warning' ? 'Aviso' : 'Erro'}
                    </span>
                    <div className="flex flex-col">
                      <p className="text-sm font-medium text-slate-800 dark:text-white">{log.action}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{log.system?.code || '—'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{new Date(log.created_at).toLocaleString('pt-BR')}</p>
                    {log.triggered_by && <p className="text-[10px] text-slate-400 dark:text-slate-500">{log.triggered_by}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Drawer>
  );
}
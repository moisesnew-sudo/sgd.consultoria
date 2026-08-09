import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Clock,
  Zap,
  Activity,
  Wifi,
  Database,
  ListChecks,
  Gauge,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { integrationAdminApi, formatDate } from '../../services/api';
import type {
  IntegrationOverview,
  IntegrationSystemStatus,
  IntegrationOperationResult,
} from '../../types';
import { PageHeader } from '../ui/PageHeader';
import { Card, Kpi } from '../ui/Card';
import { Table, TableHead, TableBody, TableEmpty, Th, Tr, Td } from '../ui/Table';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';

const HEALTH_META: Record<
  IntegrationSystemStatus['healthStatus'],
  { label: string; cls: string; icon: React.ReactNode }
> = {
  operational: {
    label: 'Operacional',
    cls: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
    icon: <CheckCircle2 size={11} className="shrink-0" />,
  },
  attention: {
    label: 'Atenção',
    cls: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    icon: <AlertTriangle size={11} className="shrink-0" />,
  },
  failure: {
    label: 'Falha',
    cls: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300',
    icon: <AlertOctagon size={11} className="shrink-0" />,
  },
};

const ALERT_SEVERITY_CLS: Record<string, string> = {
  critical: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300',
  warning: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
  info: 'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300',
};

function httpStatusCls(status: number | null): string {
  if (status === null) return 'text-slate-400';
  if (status >= 200 && status < 300) return 'text-emerald-600 dark:text-emerald-400';
  if (status >= 400) return 'text-rose-600 dark:text-rose-400';
  return 'text-amber-600 dark:text-amber-400';
}

export default function IntegrationOperationsView() {
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [overview, setOverview] = useState<IntegrationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Ação em andamento (test-connection ou sync) por sistema
  const [actionBySystem, setActionBySystem] = useState<Record<number, string>>({});

  // Confirmação de sincronização manual
  const [confirmSyncSystem, setConfirmSyncSystem] = useState<IntegrationSystemStatus | null>(null);
  const [syncInProgress, setSyncInProgress] = useState(false);

  // Modal de resultado
  const [resultModal, setResultModal] = useState<{
    open: boolean;
    kind: 'connection' | 'sync';
    systemName: string;
    result: IntegrationOperationResult;
  } | null>(null);

  const canView = hasPermission('integrations.view');
  const canSync = hasPermission('integrations.sync');

  const fetchOverview = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const data = await integrationAdminApi.getOverview();
      setOverview(data);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar a visão operacional de integrações.');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  const refresh = async () => {
    setRefreshing(true);
    await fetchOverview();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const runTestConnection = async (system: IntegrationSystemStatus) => {
    setActionBySystem(prev => ({ ...prev, [system.id]: 'test' }));
    try {
      const result = await integrationAdminApi.testConnection(system.id);
      if (result.success) {
        toast('success', 'Conexão testada com sucesso', system.name);
      } else {
        toast('error', 'Falha no teste de conexão', system.name);
      }
      setResultModal({ open: true, kind: 'connection', systemName: system.name, result });
    } catch (err: any) {
      toast('error', 'Erro ao testar conexão', err?.message || system.name);
      setResultModal({
        open: true,
        kind: 'connection',
        systemName: system.name,
        result: {
          success: false,
          status: 'error',
          durationMs: 0,
          httpStatus: null,
          message: err?.message || 'Erro ao testar conexão',
          errorMessage: err?.message || 'Erro ao testar conexão',
        },
      });
    } finally {
      setActionBySystem(prev => {
        const next = { ...prev };
        delete next[system.id];
        return next;
      });
      void fetchOverview();
    }
  };

  const runManualSync = async (system: IntegrationSystemStatus) => {
    setConfirmSyncSystem(null);
    setSyncInProgress(true);
    setActionBySystem(prev => ({ ...prev, [system.id]: 'sync' }));
    try {
      const result = await integrationAdminApi.manualSync(system.id);
      if (result.success) {
        toast('success', 'Sincronização concluída', system.name);
      } else if (result.status === 'warning') {
        toast('warning', 'Sincronização concluída com aviso', system.name);
      } else {
        toast('error', 'Falha na sincronização', system.name);
      }
      setResultModal({ open: true, kind: 'sync', systemName: system.name, result });
    } catch (err: any) {
      toast('error', 'Erro na sincronização', err?.message || system.name);
      setResultModal({
        open: true,
        kind: 'sync',
        systemName: system.name,
        result: {
          success: false,
          status: 'error',
          durationMs: 0,
          httpStatus: null,
          message: err?.message || 'Erro na sincronização',
          errorMessage: err?.message || 'Erro na sincronização',
        },
      });
    } finally {
      setSyncInProgress(false);
      setActionBySystem(prev => {
        const next = { ...prev };
        delete next[system.id];
        return next;
      });
      void fetchOverview();
    }
  };

  const summary = useMemo(() => overview?.summary ?? null, [overview]);
  const systems = overview?.systems ?? [];
  const alerts = overview?.alerts ?? [];

  if (!canView) {
    return (
      <Alert variant="danger" title="Acesso negado">
        Você não possui permissão <code className="px-1.5 py-0.5 bg-black/10 dark:bg-white/10 rounded text-xs font-mono">integrations.view</code> para acessar esta página.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestão Operacional de Integrações"
        subtitle="Visão geral do estado das integrações governamentais, teste de conexão e sincronização manual."
        icon={<Activity size={24} className="text-gov-700 dark:text-gov-300" />}
        actions={
          <Button variant="outline" icon={<RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />} onClick={refresh}>
            Atualizar
          </Button>
        }
      />

      {loading && !overview ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Skeleton className="h-28" count={5} />
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : error && !overview ? (
        <div className="space-y-4">
          <Alert variant="danger" title="Erro ao carregar" onClose={() => setError(null)}>
            {error}
          </Alert>
          <Button variant="primary" icon={<RefreshCw size={15} />} onClick={fetchOverview}>
            Tentar novamente
          </Button>
        </div>
      ) : !overview ? (
        <EmptyState
          icon={<Activity size={48} className="text-slate-300 dark:text-slate-600" />}
          title="Nenhum dado disponível"
          subtitle="A visão operacional não retornou informações. Tente atualizar."
        />
      ) : error ? (
        <Alert variant="warning" title="Falha ao atualizar" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : (
        <>
          {/* Resumo geral */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Kpi label="Integrações" value={String(summary!.total)} hint={`${summary!.active} ativas · ${summary!.inactive} inativas`} icon={<Database size={20} />} accent="gov" />
            <Kpi label="Saudáveis" value={String(summary!.healthy)} icon={<CheckCircle2 size={20} />} accent="green" />
            <Kpi label="Com Falha" value={String(summary!.failure + summary!.attention)} hint={`${summary!.attention} em atenção`} icon={<AlertOctagon size={20} />} accent={summary!.failure + summary!.attention > 0 ? 'rose' : 'green'} />
            <Kpi label="Falhas 24h" value={String(summary!.failures24h)} icon={<AlertTriangle size={20} />} accent={summary!.failures24h > 0 ? 'rose' : 'green'} />
            <Kpi label="Latência média" value={summary!.avgLatencyMs != null ? `${summary!.avgLatencyMs}ms` : '—'} hint="Últimas respostas registradas" icon={<Gauge size={20} />} accent="blue" />
          </div>

          {/* Estado do scheduler + alertas abertos */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card title="Scheduler" subtitle="Ciclo de sincronização automática" icon={<Clock size={18} />}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    overview!.scheduler.running
                      ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}>
                    <Zap size={11} className="shrink-0" />
                    {overview!.scheduler.running ? 'Em execução' : 'Ocioso'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Último ciclo</span>
                  <span className="font-mono text-xs text-slate-700 dark:text-slate-200">
                    {overview!.scheduler.lastCycleAt ? formatDate(overview!.scheduler.lastCycleAt) : 'Nunca executado'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Última sincronização global</span>
                  <span className="font-mono text-xs text-slate-700 dark:text-slate-200">
                    {summary!.lastSync ? formatDate(summary!.lastSync) : '—'}
                  </span>
                </div>
              </div>
            </Card>

            <Card title="Alertas abertos" subtitle="Alertas não resolvidos por sistema" icon={<AlertTriangle size={18} />} className="lg:col-span-2">
              {alerts.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 size={40} className="text-emerald-200 dark:text-emerald-700/60" />}
                  title="Nenhum alerta aberto"
                  subtitle="Todos os alertas foram resolvidos."
                />
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {alerts.map(a => (
                    <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${ALERT_SEVERITY_CLS[a.severity] || ALERT_SEVERITY_CLS.info}`}>
                        <AlertTriangle size={10} className="shrink-0" />
                        {a.severity}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{a.systemName}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{a.message || a.type}</p>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap">{formatDate(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Tabela de sistemas */}
          <Card
            title="Integrações"
            subtitle="Estado, sincronização e ações operacionais"
            icon={<ListChecks size={18} />}
          >
            {!canSync && (
              <div className="px-5 pt-4">
                <Alert variant="info" title="Permissão parcial">
                  Você pode visualizar as integrações, mas as ações de teste de conexão e sincronização manual exigem a permissão <code className="px-1.5 py-0.5 bg-black/10 dark:bg-white/10 rounded text-[11px] font-mono">integrations.sync</code>.
                </Alert>
              </div>
            )}
            <Table minWidth={1100}>
              <TableHead>
                <Th>Sistema</Th>
                <Th align="center">Status</Th>
                <Th>Última sincronização</Th>
                <Th>Próxima sincronização</Th>
                <Th align="center">Último HTTP</Th>
                <Th align="center">Erros consecutivos</Th>
                <Th align="right">Latência</Th>
                <Th align="center">Alertas</Th>
                <Th align="center">Ações</Th>
              </TableHead>
              <TableBody>
                {systems.length === 0 && (
                  <TableEmpty colSpan={9} message="Nenhum sistema de integração cadastrado." />
                )}
                {systems.map(system => {
                  const meta = HEALTH_META[system.healthStatus];
                  const action = actionBySystem[system.id];
                  const hasAlerts = system.alerts.length > 0;
                  return (
                    <Tr key={system.id}>
                      <Td>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{system.name}</span>
                          <span className="text-[10px] font-mono text-slate-400">{system.code}</span>
                        </div>
                      </Td>
                      <Td align="center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${meta.cls}`}>
                          {meta.icon}
                          {meta.label}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {system.lastSyncAt ? formatDate(system.lastSyncAt) : '—'}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {system.nextSyncAt ? formatDate(system.nextSyncAt) : '—'}
                        </span>
                      </Td>
                      <Td align="center">
                        <span className={`font-mono text-[11px] font-bold ${httpStatusCls(system.httpStatus)}`}>
                          {system.httpStatus !== null ? system.httpStatus : '—'}
                        </span>
                      </Td>
                      <Td align="center">
                        <span className={`font-mono text-[11px] font-bold ${system.consecutiveErrors > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {system.consecutiveErrors}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {system.responseTime != null ? `${system.responseTime}ms` : '—'}
                        </span>
                      </Td>
                      <Td align="center">
                        {hasAlerts ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                            <AlertOctagon size={11} className="shrink-0" />
                            {system.alerts.length}
                          </span>
                        ) : (
                          <CheckCircle2 size={16} className="mx-auto text-emerald-500" />
                        )}
                      </Td>
                      <Td align="center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            loading={action === 'test'}
                            disabled={!canSync}
                            icon={<Wifi size={13} />}
                            onClick={() => runTestConnection(system)}
                            title={!canSync ? 'Requer permissão integrations.sync' : undefined}
                          >
                            Testar conexão
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            loading={action === 'sync'}
                            disabled={!canSync}
                            icon={<RefreshCw size={13} />}
                            onClick={() => setConfirmSyncSystem(system)}
                            title={!canSync ? 'Requer permissão integrations.sync' : undefined}
                          >
                            Sincronizar
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* Confirmação antes de sincronizar */}
      <Modal
        open={confirmSyncSystem !== null}
        title="Sincronizar integração"
        subtitle={confirmSyncSystem?.name}
        size="sm"
        onClose={syncInProgress ? undefined : () => setConfirmSyncSystem(null)}
        icon={<RefreshCw size={18} className="text-gov-700 dark:text-gov-300" />}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setConfirmSyncSystem(null)} disabled={syncInProgress}>
              Cancelar
            </Button>
            <Button variant="primary" size="md" loading={syncInProgress} onClick={() => confirmSyncSystem && runManualSync(confirmSyncSystem)}>
              Confirmar sincronização
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          Esta ação executará uma sincronização manual com o sistema <strong className="text-slate-700 dark:text-slate-200">{confirmSyncSystem?.name}</strong>, acionando o processador de eventos do SGD. Deseja continuar?
        </p>
      </Modal>

      {/* Resultado da operação */}
      <Modal
        open={resultModal?.open ?? false}
        title={resultModal?.kind === 'connection' ? 'Resultado do Teste de Conexão' : 'Resultado da Sincronização'}
        subtitle={resultModal?.systemName}
        onClose={() => setResultModal(null)}
        icon={resultModal?.result.success ? <CheckCircle2 size={18} className="text-emerald-500" /> : <AlertOctagon size={18} className="text-rose-500" />}
        footer={
          <Button variant="primary" size="md" onClick={() => setResultModal(null)}>
            Fechar
          </Button>
        }
      >
        {resultModal && (
          <div className="space-y-4">
            <div className={`p-3.5 rounded-xl border flex items-center gap-3 ${
              resultModal.result.success
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50'
                : resultModal.result.status === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50'
                  : 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/50'
            }`}>
              {resultModal.result.success ? (
                <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
              ) : resultModal.result.status === 'warning' ? (
                <AlertTriangle size={20} className="text-amber-500 shrink-0" />
              ) : (
                <AlertOctagon size={20} className="text-rose-500 shrink-0" />
              )}
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{resultModal.result.message}</p>
                {resultModal.result.errorMessage && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{resultModal.result.errorMessage}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                <p className="text-[10px] font-bold uppercase text-slate-400">HTTP status</p>
                <p className={`mt-1 font-mono font-bold ${httpStatusCls(resultModal.result.httpStatus)}`}>
                  {resultModal.result.httpStatus !== null ? resultModal.result.httpStatus : '—'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                <p className="text-[10px] font-bold uppercase text-slate-400">Duração</p>
                <p className="mt-1 font-mono font-bold text-slate-700 dark:text-slate-200">{resultModal.result.durationMs}ms</p>
              </div>
              {resultModal.kind === 'connection' && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Autenticação</p>
                  <p className="mt-1 text-xs font-bold text-slate-700 dark:text-slate-200">
                    {resultModal.result.authenticated === null
                      ? 'Não avaliada'
                      : resultModal.result.authenticated ? 'Válida' : 'Sem credencial'}
                  </p>
                </div>
              )}
              {resultModal.kind === 'sync' && resultModal.result.eventId !== undefined && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Evento processado</p>
                  <p className="mt-1 font-mono font-bold text-slate-700 dark:text-slate-200">#{resultModal.result.eventId}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
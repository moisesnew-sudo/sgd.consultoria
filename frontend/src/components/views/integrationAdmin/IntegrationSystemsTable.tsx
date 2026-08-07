import { useEffect, useState, useCallback } from 'react';
import { Plus, Edit, RefreshCw, Server, Eye, Power, Loader2 } from 'lucide-react';
import { Table, TableHead, TableBody, TableEmpty, Th, Tr, Td } from '../../ui/Table';
import { PageHeader } from '../../ui/PageHeader';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { Alert } from '../../ui/Alert';
import ExportMenu from '../../ui/ExportMenu';
import { Pagination } from '../../ui/Table';
import { integrationAdminApi } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import type { IntegrationSystem } from '../../../types';

interface SystemsFilters {
  page: number;
  limit: number;
  search?: string;
  active?: boolean;
}

function TableSkeleton() {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, i) => (
        <Tr key={i}>
          <Td><Skeleton className="h-5 w-24" /></Td>
          <Td><Skeleton className="h-5 w-20" /></Td>
          <Td><Skeleton className="h-5 w-32" /></Td>
          <Td><Skeleton className="h-5 w-16" /></Td>
          <Td><Skeleton className="h-5 w-16" /></Td>
          <Td><Skeleton className="h-5 w-16" /></Td>
          <Td><Skeleton className="h-5 w-32" /></Td>
        </Tr>
      ))}
    </TableBody>
  );
}

interface IntegrationSystemsTableProps {
  onRefresh?: () => void;
  onView?: (id: number) => void;
  onEdit?: (system: import('../../../types').IntegrationSystem) => void;
  onCreate?: () => void;
  onSync?: (id: number, name: string) => void;
  canManage?: boolean;
  canSync?: boolean;
  refreshKey?: number;
}

export default function IntegrationSystemsTable({ onRefresh, onView, onEdit, onCreate, onSync, canManage, canSync, refreshKey }: IntegrationSystemsTableProps) {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [systems, setSystems] = useState<import('../../../types').IntegrationSystem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [filters, setFilters] = useState<{ page: number; limit: number; search?: string; active?: boolean }>({
    page: 1,
    limit: 20,
  });

  const canManagePerm = hasPermission('integrations.manage');
  const canSyncPerm = hasPermission('integrations.sync');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await integrationAdminApi.getSystems(filters);
      setSystems(data.data);
      setPagination(data.pagination);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar sistemas');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (refreshKey && refreshKey > 0) load();
  }, [refreshKey, load]);

  const handleToggleActive = async (system: IntegrationSystem) => {
    if (!canManage) return;
    setTogglingId(system.id);
    try {
      await integrationAdminApi.setSystemActive(system.id, !system.active);
      toast('success', system.active ? 'Sistema desativado' : 'Sistema ativado');
      load();
    } catch (e: any) {
      toast('error', 'Erro ao alterar status', e?.message || 'Não foi possível alterar o status do sistema');
    } finally {
      setTogglingId(null);
    }
  };

  const handleRefresh = () => {
    load();
    onRefresh?.();
  };

  const applyFilters = (newFilters: Partial<{ page: number; limit: number; search?: string; active?: boolean }>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
    setFiltersOpen(false);
  };

  const clearFilters = () => {
    setFilters({ page: 1, limit: 20 });
    setFiltersOpen(false);
  };

  const hasActiveFilters = !!(filters.search || filters.active !== undefined);

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Sistemas de Integração"
          subtitle="Gerencie os sistemas integrados ao SGD"
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
              <Th>Código</Th>
              <Th>Descrição</Th>
              <Th>Status</Th>
              <Th>Adapter</Th>
              <Th>Secret</Th>
              <Th>Ações</Th>
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
          title="Sistemas de Integração"
          subtitle="Gerencie os sistemas integrados ao SGD"
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sistemas de Integração"
        subtitle="Gerencie os sistemas integrados ao SGD"
        icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
        actions={
          <>
            <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>
              Novo Sistema
            </Button>
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              Atualizar
            </Button>
          </>
        }
      />

      <div className="overflow-x-auto">
        <Table minWidth={720}>
          <TableHead>
            <Th>Nome</Th>
            <Th>Código</Th>
            <Th>Descrição</Th>
            <Th>Status</Th>
            <Th>Adapter</Th>
            <Th>Secret</Th>
            <Th>Ações</Th>
          </TableHead>
          <TableBody>
            {systems.length === 0 && <TableEmpty colSpan={7} message="Nenhum sistema de integração configurado." />}
            {systems.map((system) => (
              <Tr key={system.id}>
                <Td>
                  <p className="font-extrabold text-slate-800 dark:text-white">{system.name}</p>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{system.code}</span>
                </Td>
                <Td>
                  <p className="text-sm text-slate-600 dark:text-slate-300 truncate max-w-xs">
                    {system.description || '—'}
                  </p>
                </Td>
                <Td>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${system.active
                    ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                    {system.active ? 'Ativo' : 'Inativo'}
                  </span>
                </Td>
                <Td>
                  <span className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                    {system.config?.adapter ? String(system.config.adapter) : '—'}
                  </span>
                </Td>
                <Td>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${system.secretConfigured
                    ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'}`}>
                    {system.secretConfigured ? 'Configurado' : 'Não configurado'}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onView?.(system.id)}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Ver detalhes"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit?.(system)}
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Editar"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(system)}
                      disabled={!canManage || togglingId === system.id}
                      className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer ${system.active
                        ? 'text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600 dark:hover:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'} ${(!canManage || togglingId === system.id) ? 'opacity-30 cursor-not-allowed' : ''}`}
                      title={system.active ? 'Desativar' : 'Ativar'}
                    >
                      {togglingId === system.id ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSync?.(system.id, system.name)}
                      disabled={!canSync}
                      className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer ${!canSync ? 'opacity-30 cursor-not-allowed' : ''}`}
                      title="Sincronizar"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={pagination.page}
        pages={Math.max(pagination.totalPages, 1)}
        total={pagination.total}
        onChange={(page) => applyFilters({ page })}
        label={`Página ${pagination.page} de ${Math.max(pagination.totalPages, 1)} · ${pagination.total} registros`}
      />
    </div>
  );
}
import { useEffect, useState, useCallback } from 'react';
import { Filter, Download, RefreshCw, Server, ChevronLeft, ChevronRight } from 'lucide-react';
import { Table, TableHead, TableBody, TableEmpty, Th, Tr, Td } from '../../ui/Table';
import { Card } from '../../ui/Card';
import { PageHeader } from '../../ui/PageHeader';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { Alert } from '../../ui/Alert';
import { EmptyState } from '../../ui/EmptyState';
import { FiltersDrawer } from '../../ui/FiltersDrawer';
import ExportMenu from '../../ui/ExportMenu';
import { Pagination } from '../../ui/Table';
import { formatDateShort } from '../../../services/api';
import { integrationAdminApi } from '../../../services/api';
import type { IntegrationLogEntry, IntegrationLogsResponse, IntegrationAdapter } from '../../../types';

interface LogsFilters {
  page: number;
  limit: number;
  system?: number;
  systemCode?: string;
  status?: string;
  direction?: string;
  from?: string;
  to?: string;
  error?: boolean;
  search?: string;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  success: { label: 'Sucesso', cls: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' },
  warning: { label: 'Aviso', cls: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300' },
  error: { label: 'Erro', cls: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300' },
};

const DIRECTION_LABELS: Record<string, string> = {
  in: 'Entrada',
  out: 'Saída',
};

interface LogsFiltersState {
  page: number;
  limit: number;
  system?: number;
  systemCode?: string;
  status?: string;
  direction?: string;
  from?: string;
  to?: string;
  error?: boolean;
  search?: string;
}

function TableSkeleton() {
  return (
    <TableBody>
      {Array.from({ length: 5 }).map((_, i) => (
        <Tr key={i}>
          <Td><Skeleton className="h-5 w-24" /></Td>
          <Td><Skeleton className="h-5 w-20" /></Td>
          <Td><Skeleton className="h-5 w-16" /></Td>
          <Td><Skeleton className="h-5 w-16" /></Td>
          <Td><Skeleton className="h-5 w-16" /></Td>
          <Td><Skeleton className="h-5 w-12" /></Td>
          <Td><Skeleton className="h-5 w-20" /></Td>
          <Td><Skeleton className="h-5 w-16" /></Td>
        </Tr>
      ))}
    </TableBody>
  );
}

interface LogsFiltersState {
  page: number;
  limit: number;
  system?: number;
  systemCode?: string;
  status?: string;
  direction?: string;
  from?: string;
  to?: string;
  error?: boolean;
  search?: string;
}

interface IntegrationLogsTableProps {
  onRefresh?: () => void;
}

export default function IntegrationLogsTable({ onRefresh }: IntegrationLogsTableProps) {
  const [logs, setLogs] = useState<IntegrationLogEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<LogsFiltersState>({
    page: 1,
    limit: 20,
  });
  const [systems, setSystems] = useState<IntegrationAdapter[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await integrationAdminApi.getLogs(filters);
      setLogs(data.data);
      setPagination(data.pagination);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
    integrationAdminApi.getAdapters().then(({ data }) => setSystems(data)).catch(() => {});
  }, [load]);

  const handleRefresh = () => {
    load();
    onRefresh?.();
  };

  const applyFilters = (newFilters: Partial<LogsFiltersState>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
    setFiltersOpen(false);
  };

  const clearFilters = () => {
    setFilters({
      page: 1,
      limit: 20,
    });
    setFiltersOpen(false);
  };

  const hasActiveFilters = !!(filters.system || filters.status || filters.direction || filters.from || filters.to || filters.error || filters.search);

  const exportCSV = async () => {
    const headers = ['Sistema', 'Ação', 'Direção', 'Status', 'Duração (ms)', 'HTTP', 'Data', 'Origem'];
    const rows = logs.map(log => [
      log.system?.code || '—',
      log.action,
      log.direction === 'in' ? 'Entrada' : 'Saída',
      log.status,
      log.duration_ms?.toString() || '—',
      log.http_status?.toString() || '—',
      formatDateShort(log.created_at),
      log.triggered_by || '—',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `integration-logs-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  const exportJSON = async () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `integration-logs-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Histórico de Integrações"
          subtitle="Registro de execuções e eventos dos sistemas integrados"
          icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
          actions={
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              Atualizar
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <Table minWidth={900}>
            <TableHead>
              <Th>Sistema</Th>
              <Th>Ação</Th>
              <Th>Direção</Th>
              <Th>Status</Th>
              <Th>Duração</Th>
              <Th>HTTP</Th>
              <Th>Data</Th>
              <Th>Origem</Th>
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
          title="Histórico de Integrações"
          subtitle="Registro de execuções e eventos dos sistemas integrados"
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

  const exportItems = [
    {
      id: 'csv',
      label: 'CSV',
      description: 'Exportar dados filtrados em formato CSV',
      icon: <Download size={16} />,
      onSelect: exportCSV,
    },
    {
      id: 'json',
      label: 'JSON',
      description: 'Exportar dados filtrados em formato JSON',
      icon: <Download size={16} />,
      onSelect: exportJSON,
    },
  ];

  const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    success: { label: 'Sucesso', cls: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300' },
    warning: { label: 'Aviso', cls: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300' },
    error: { label: 'Erro', cls: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300' },
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Histórico de Integrações"
        subtitle="Registro de execuções e eventos dos sistemas integrados"
        icon={<Server size={24} className="text-gov-700 dark:text-gov-300" />}
        actions={
          <div className="flex items-center gap-2">
            <ExportMenu items={exportItems} buttonLabel="Exportar" buttonIcon={<Download size={14} />} />
            <Button variant="outline" size="sm" icon={<Filter size={14} />} onClick={() => setFiltersOpen(true)}>
              Filtros
            </Button>
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={handleRefresh}>
              Atualizar
            </Button>
          </div>
        }
      />

      <FiltersDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onApply={() => {}}
        onClear={clearFilters}
        title="Filtros do Histórico"
        subtitle="Aplique filtros para refinar a busca"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Sistema</label>
            <select
              value={filters.system || ''}
              onChange={(e) => applyFilters({ system: e.target.value ? Number(e.target.value) : undefined })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600"
            >
              <option value="">Todos os sistemas</option>
              {systems.map(s => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Status</label>
            <select
              value={filters.status || ''}
              onChange={(e) => applyFilters({ status: e.target.value || undefined })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600"
            >
              <option value="">Todos os status</option>
              <option value="success">Sucesso</option>
              <option value="warning">Aviso</option>
              <option value="error">Erro</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Direção</label>
            <select
              value={filters.direction || ''}
              onChange={(e) => applyFilters({ direction: e.target.value || undefined })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600"
            >
              <option value="">Todas</option>
              <option value="in">Entrada</option>
              <option value="out">Saída</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Busca</label>
            <input
              type="text"
              value={filters.search || ''}
              onChange={(e) => applyFilters({ search: e.target.value || undefined })}
              placeholder="Buscar mensagem, ação, sistema..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Data inicial</label>
            <input
              type="date"
              value={filters.from || ''}
              onChange={(e) => applyFilters({ from: e.target.value || undefined })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Data final</label>
            <input
              type="date"
              value={filters.to || ''}
              onChange={(e) => applyFilters({ to: e.target.value || undefined })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.error === true}
                onChange={(e) => applyFilters({ error: e.target.checked || undefined })}
                className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">Apenas com erro</span>
            </label>
          </div>
        </div>
      </FiltersDrawer>

      <div className="overflow-x-auto">
        <Table minWidth={900}>
          <TableHead>
            <Th>Sistema</Th>
            <Th>Ação</Th>
            <Th>Direção</Th>
            <Th>Status</Th>
            <Th>Duração</Th>
            <Th>HTTP</Th>
            <Th>Data</Th>
            <Th>Origem</Th>
          </TableHead>
          <TableBody>
            {logs.length === 0 && <TableEmpty colSpan={8} message="Nenhum registro de execução encontrado." />}
            {logs.map((log) => {
              const statusConfig = STATUS_LABELS[log.status];
              const directionLabel = log.direction === 'in' ? 'Entrada' : 'Saída';
              return (
                <Tr key={log.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{log.system?.code || '—'}</span>
                    </div>
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-700 dark:text-slate-200 truncate block max-w-xs">{log.action}</span>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${log.direction === 'in' ? 'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300' : 'bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300'}`}>
                      {directionLabel}
                    </span>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_LABELS[log.status].cls}`}>
                      {STATUS_LABELS[log.status].label}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {log.duration_ms !== null ? `${log.duration_ms}ms` : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {log.http_status !== null ? log.http_status : '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {formatDateShort(log.created_at)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate block max-w-xs">{log.triggered_by || '—'}</span>
                  </Td>
                </Tr>
              );
            })}
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
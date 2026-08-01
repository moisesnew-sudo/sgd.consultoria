import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, X, SlidersHorizontal, FilterX, RefreshCw, ScrollText, AlertCircle } from 'lucide-react';
import { auditApi, formatDate } from '../services/api';
import { Badge, Input, Select, FiltersDrawer, Table, TableHead, Th, TableBody, Tr, Td, TableEmpty, Pagination } from './ui';
import { TableSkeleton } from './ui/Skeleton';

interface AuditRow {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  user_id?: number;
  user_name: string;
  ip_address?: string;
  details: any;
  created_at: string;
}

const ACTION_META: Record<string, { label: string; variant: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' }> = {
  create: { label: 'Criação', variant: 'success' },
  update: { label: 'Edição', variant: 'info' },
  delete: { label: 'Exclusão', variant: 'danger' },
  comment: { label: 'Comentário', variant: 'warning' },
  login: { label: 'Login', variant: 'brand' },
  login_failed: { label: 'Falha de Login', variant: 'danger' },
  update_permissions: { label: 'Permissões', variant: 'info' },
};

const ENTITY_LABELS: Record<string, string> = {
  demand: 'Demanda', user: 'Usuário', session: 'Sessão', backup: 'Backup',
  export_log: 'Exportação', export: 'Exportação', settings: 'Configuração', timeline: 'Timeline'
};

const ENTITY_OPTIONS = ['demand', 'user', 'session', 'backup', 'export', 'settings'];
const ACTION_OPTIONS = ['create', 'update', 'delete', 'comment', 'login', 'login_failed', 'update_permissions'];
const PAGE_SIZE = 50;

interface AuditFilters {
  entityType: string;
  action: string;
  dateFrom: string;
  dateTo: string;
  userName: string;
}

const EMPTY_FILTERS: AuditFilters = { entityType: 'all', action: 'all', dateFrom: '', dateTo: '', userName: 'all' };

const fmtDetails = (details: any): string => {
  if (details == null) return '—';
  if (typeof details === 'string') return details;
  try { return JSON.stringify(details); } catch { return String(details); }
};

export default function AuditTrail() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, pagination } = await auditApi.list({
        entity_type: filters.entityType !== 'all' ? filters.entityType : undefined,
        action: filters.action !== 'all' ? filters.action : undefined,
        start_date: filters.dateFrom || undefined,
        end_date: filters.dateTo || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setLogs(data);
      setTotal(pagination?.total ?? data.length);
      setPages(pagination?.pages ?? 1);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar logs de auditoria');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (search || filters.userName !== 'all') setPage(1);
  }, [search, filters.userName]);

  const applyFilters = () => {
    setFilters(draft);
    setPage(1);
    setFiltersOpen(false);
  };

  const clearAllFilters = () => {
    setFilters(EMPTY_FILTERS);
    setDraft(EMPTY_FILTERS);
    setSearch('');
    setPage(1);
  };

  const removeFilter = (key: keyof AuditFilters) => {
    setFilters(prev => {
      const next = { ...prev, [key]: EMPTY_FILTERS[key] };
      setDraft(next);
      return next;
    });
    setPage(1);
  };

  const activeFilterCount =
    (filters.entityType !== 'all' ? 1 : 0) +
    (filters.action !== 'all' ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0) +
    (filters.userName !== 'all' ? 1 : 0);

  const userNames = useMemo(() => {
    const names = new Set<string>();
    logs.forEach(l => { if (l.user_name) names.add(l.user_name); });
    return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [logs]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = logs;
    if (filters.userName !== 'all') list = list.filter(l => l.user_name === filters.userName);
    if (term) {
      list = list.filter(l => {
        const actionLabel = (ACTION_META[l.action]?.label || l.action || '').toLowerCase();
        return (
          (l.user_name || '').toLowerCase().includes(term) ||
          (l.entity_type || '').toLowerCase().includes(term) ||
          (l.entity_id || '').toLowerCase().includes(term) ||
          actionLabel.includes(term) ||
          fmtDetails(l.details).toLowerCase().includes(term)
        );
      });
    }
    return list;
  }, [logs, search, filters.userName]);

  const chips: { id: string; label: string; onRemove: () => void }[] = [];
  if (filters.entityType !== 'all') chips.push({ id: 'entityType', label: `Tipo: ${ENTITY_LABELS[filters.entityType] || filters.entityType}`, onRemove: () => removeFilter('entityType') });
  if (filters.action !== 'all') chips.push({ id: 'action', label: `Ação: ${ACTION_META[filters.action]?.label || filters.action}`, onRemove: () => removeFilter('action') });
  if (filters.dateFrom || filters.dateTo) chips.push({ id: 'period', label: `Período: ${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`, onRemove: () => removeFilter('dateFrom') });
  if (filters.userName !== 'all') chips.push({ id: 'userName', label: `Usuário: ${filters.userName}`, onRemove: () => removeFilter('userName') });

  return (
    <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl shadow-sm overflow-hidden">
      {/* Action bar */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-700/50 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
            <ScrollText size={14} className="text-emerald-600" /> Histórico de Ações
          </h3>
          {!loading && (
            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[9px] font-black text-slate-500 dark:text-slate-400 font-mono">
              {filtered.length} / {total}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar: usuário, entidade, detalhes..."
              className="w-full h-[40px] pl-9 pr-8 rounded-xl border text-sm bg-white dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent border-slate-200 dark:border-slate-700"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Limpar pesquisa" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiltersOpen(true)}
              className={`flex items-center gap-2 px-3 h-[40px] rounded-xl border text-xs font-bold transition-colors ${
                activeFilterCount > 0
                  ? 'bg-brand-50 dark:bg-brand-950/30 border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-300'
                  : 'bg-white dark:bg-[#111a2e] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal size={14} />
              Filtros
              {activeFilterCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[9px] font-black flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button onClick={load} title="Atualizar" className="p-2 h-[40px] aspect-square rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/50 flex flex-wrap items-center gap-1.5">
          {chips.map(chip => (
            <button
              key={chip.id}
              onClick={chip.onRemove}
              title={`Remover filtro ${chip.label}`}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
            >
              {chip.label}
              <span className="p-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-red-100 hover:text-red-600 transition-colors">
                <X size={11} />
              </span>
            </button>
          ))}
          <button
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            <FilterX size={12} /> Limpar todos
          </button>
        </div>
      )}

      {error ? (
        <div className="p-12 text-center space-y-3">
          <AlertCircle size={32} className="mx-auto text-red-400" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{error}</p>
          <button onClick={load} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800 transition-colors">
            <RefreshCw size={14} />
            Tentar novamente
          </button>
        </div>
      ) : loading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : (
        <>
          <Table minWidth={820}>
            <TableHead>
              <Th>Data/Hora</Th>
              <Th>Usuário</Th>
              <Th>Ação</Th>
              <Th>Entidade</Th>
              <Th>Detalhes</Th>
            </TableHead>
            <TableBody>
              {filtered.map(log => (
                <Tr key={log.id}>
                  <Td className="text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {log.created_at ? formatDate(log.created_at) : '—'}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{log.user_name || '—'}</p>
                    {log.ip_address && <p className="text-[9px] font-mono text-slate-400 mt-0.5">{log.ip_address}</p>}
                  </Td>
                  <Td>
                    <Badge size="sm" variant={ACTION_META[log.action]?.variant || 'neutral'}>
                      {ACTION_META[log.action]?.label || log.action || '—'}
                    </Badge>
                  </Td>
                  <Td className="text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    <span className="text-slate-400 dark:text-slate-500">{ENTITY_LABELS[log.entity_type] || log.entity_type || '?'}</span>
                    <span className="mx-1 opacity-50">/</span>
                    <span className="text-slate-700 dark:text-slate-300">{log.entity_id || '?'}</span>
                  </Td>
                  <Td className="text-[11px] font-mono text-slate-500 dark:text-slate-400 max-w-[380px] truncate" title={fmtDetails(log.details)}>
                    {fmtDetails(log.details)}
                  </Td>
                </Tr>
              ))}
              {filtered.length === 0 && <TableEmpty colSpan={5} message="Nenhum registro de auditoria encontrado." />}
            </TableBody>
          </Table>

          <Pagination page={page} pages={pages} total={total} onChange={setPage} />
        </>
      )}

      {/* Filters drawer (Design System) */}
      <FiltersDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onApply={applyFilters}
        onClear={() => setDraft(EMPTY_FILTERS)}
      >
        <Select label="Tipo de Entidade" value={draft.entityType} onChange={e => setDraft(prev => ({ ...prev, entityType: e.target.value }))}>
          <option value="all">Todos os tipos</option>
          {ENTITY_OPTIONS.map(t => (
            <option key={t} value={t}>{ENTITY_LABELS[t] || t}</option>
          ))}
        </Select>
        <Select label="Ação" value={draft.action} onChange={e => setDraft(prev => ({ ...prev, action: e.target.value }))}>
          <option value="all">Todas as ações</option>
          {ACTION_OPTIONS.map(a => (
            <option key={a} value={a}>{ACTION_META[a]?.label || a}</option>
          ))}
        </Select>
        <Select label="Usuário" value={draft.userName} onChange={e => setDraft(prev => ({ ...prev, userName: e.target.value }))}>
          <option value="all">Todos os usuários</option>
          {userNames.map(u => (
            <option key={u} value={u}>{u}</option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data Início" type="date" value={draft.dateFrom} onChange={e => setDraft(prev => ({ ...prev, dateFrom: e.target.value }))} />
          <Input label="Data Fim" type="date" value={draft.dateTo} onChange={e => setDraft(prev => ({ ...prev, dateTo: e.target.value }))} />
        </div>
      </FiltersDrawer>
    </div>
  );
}

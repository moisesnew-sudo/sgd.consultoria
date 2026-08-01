import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, X, SlidersHorizontal, FilterX, RefreshCw, ScrollText, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { auditApi, formatDate } from '../services/api';
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

const ACTION_META: Record<string, { label: string; cls: string }> = {
  create: { label: 'Criação', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50' },
  update: { label: 'Edição', cls: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50' },
  delete: { label: 'Exclusão', cls: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/50' },
  comment: { label: 'Comentário', cls: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50' },
  login: { label: 'Login', cls: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/50' },
  login_failed: { label: 'Falha de Login', cls: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50' },
  update_permissions: { label: 'Permissões', cls: 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800/50' },
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

  const selectCls = 'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-600';
  const dateCls = 'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-600';

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
              className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
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
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
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
            <button onClick={load} title="Atualizar" className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
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
        <TableSkeleton rows={6} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-left text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">
                  <th className="px-5 py-3.5">Data/Hora</th>
                  <th className="px-5 py-3.5">Usuário</th>
                  <th className="px-5 py-3.5">Ação</th>
                  <th className="px-5 py-3.5">Entidade</th>
                  <th className="px-5 py-3.5">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {filtered.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3 text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {log.created_at ? formatDate(log.created_at) : '—'}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{log.user_name || '—'}</p>
                      {log.ip_address && <p className="text-[9px] font-mono text-slate-400 mt-0.5">{log.ip_address}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wide whitespace-nowrap ${ACTION_META[log.action]?.cls || 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}>
                        {ACTION_META[log.action]?.label || log.action || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      <span className="text-slate-400 dark:text-slate-500">{ENTITY_LABELS[log.entity_type] || log.entity_type || '?'}</span>
                      <span className="mx-1 opacity-50">/</span>
                      <span className="text-slate-700 dark:text-slate-300">{log.entity_id || '?'}</span>
                    </td>
                    <td className="px-5 py-3 text-[11px] font-mono text-slate-500 dark:text-slate-400 max-w-[380px] truncate" title={fmtDetails(log.details)}>
                      {fmtDetails(log.details)}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400 italic">Nenhum registro de auditoria encontrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[10px] font-mono text-slate-400">
              Página {page} de {Math.max(pages, 1)} · {total} registros
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                title="Página anterior"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                title="Próxima página"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Filters drawer */}
      {filtersOpen && (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setFiltersOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-[#111a2e] shadow-2xl animate-drawer flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700/50">
              <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-brand-600" /> Filtros
              </h3>
              <button onClick={() => setFiltersOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Tipo de Entidade</label>
                <select value={draft.entityType} onChange={e => setDraft(prev => ({ ...prev, entityType: e.target.value }))} className={selectCls}>
                  <option value="all">Todos os tipos</option>
                  {ENTITY_OPTIONS.map(t => (
                    <option key={t} value={t}>{ENTITY_LABELS[t] || t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Ação</label>
                <select value={draft.action} onChange={e => setDraft(prev => ({ ...prev, action: e.target.value }))} className={selectCls}>
                  <option value="all">Todas as ações</option>
                  {ACTION_OPTIONS.map(a => (
                    <option key={a} value={a}>{ACTION_META[a]?.label || a}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Usuário</label>
                <select value={draft.userName} onChange={e => setDraft(prev => ({ ...prev, userName: e.target.value }))} className={selectCls}>
                  <option value="all">Todos os usuários</option>
                  {userNames.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Data Início</label>
                  <input type="date" value={draft.dateFrom} onChange={e => setDraft(prev => ({ ...prev, dateFrom: e.target.value }))} className={dateCls} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Data Fim</label>
                  <input type="date" value={draft.dateTo} onChange={e => setDraft(prev => ({ ...prev, dateTo: e.target.value }))} className={dateCls} />
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700/50 flex items-center gap-2">
              <button
                onClick={() => { setDraft(EMPTY_FILTERS); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <FilterX size={14} /> Limpar
              </button>
              <button
                onClick={applyFilters}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors"
              >
                Aplicar filtros
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

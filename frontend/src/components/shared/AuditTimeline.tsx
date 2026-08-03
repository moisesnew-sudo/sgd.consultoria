import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search, X, SlidersHorizontal, FilterX, RefreshCw, ScrollText, AlertCircle,
  PlusCircle, Pencil, Trash2, MessageSquare, LogIn, LogOut, Upload, Download,
  Shield, ArrowRight, ChevronDown, ChevronUp, Globe, Monitor
} from 'lucide-react';
import { auditApi, formatDate } from '../../services/api';
import { AuditLog } from '../../types';
import { Input, Select, FiltersDrawer } from '../ui';

const ACTION_CONFIG: Record<string, { label: string; verb: string; icon: React.ReactNode; color: string; bg: string; ring: string }> = {
  create:           { label: 'Criação',           verb: 'cadastrou',       icon: <PlusCircle size={14} />,   color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/40', ring: 'ring-emerald-500/20' },
  update:           { label: 'Edição',            verb: 'editou',          icon: <Pencil size={14} />,        color: 'text-blue-600',    bg: 'bg-blue-100 dark:bg-blue-900/40',     ring: 'ring-blue-500/20' },
  delete:           { label: 'Exclusão',          verb: 'excluiu',         icon: <Trash2 size={14} />,        color: 'text-red-600',     bg: 'bg-red-100 dark:bg-red-900/40',       ring: 'ring-red-500/20' },
  restore:          { label: 'Restauração',       verb: 'restaurou',       icon: <ArrowRight size={14} />,    color: 'text-amber-600',   bg: 'bg-amber-100 dark:bg-amber-900/40',   ring: 'ring-amber-500/20' },
  comment:          { label: 'Comentário',        verb: 'comentou em',     icon: <MessageSquare size={14} />, color: 'text-violet-600',  bg: 'bg-violet-100 dark:bg-violet-900/40', ring: 'ring-violet-500/20' },
  login:            { label: 'Login',             verb: 'fez login',       icon: <LogIn size={14} />,         color: 'text-indigo-600',  bg: 'bg-indigo-100 dark:bg-indigo-900/40', ring: 'ring-indigo-500/20' },
  login_failed:     { label: 'Falha de Login',    verb: 'tentou login',    icon: <LogOut size={14} />,        color: 'text-red-600',     bg: 'bg-red-100 dark:bg-red-900/40',       ring: 'ring-red-500/20' },
  login_locked:     { label: 'Conta Bloqueada',   verb: 'conta bloqueada', icon: <Shield size={14} />,        color: 'text-red-600',     bg: 'bg-red-100 dark:bg-red-900/40',       ring: 'ring-red-500/20' },
  upload:           { label: 'Upload',            verb: 'enviou arquivo(s) para', icon: <Upload size={14} />,  color: 'text-cyan-600',    bg: 'bg-cyan-100 dark:bg-cyan-900/40',     ring: 'ring-cyan-500/20' },
  export:           { label: 'Exportação',        verb: 'exportou dados de', icon: <Download size={14} />,    color: 'text-teal-600',    bg: 'bg-teal-100 dark:bg-teal-900/40',     ring: 'ring-teal-500/20' },
  update_permissions: { label: 'Permissões',      verb: 'alterou permissões de', icon: <Shield size={14} />,  color: 'text-orange-600',  bg: 'bg-orange-100 dark:bg-orange-900/40', ring: 'ring-orange-500/20' },
};

const ENTITY_LABELS: Record<string, string> = {
  demand: 'Demanda', user: 'Usuário', session: 'Sessão', backup: 'Backup',
  export_log: 'Exportação', export: 'Exportação', settings: 'Configuração', timeline: 'Timeline'
};

const ENTITY_OPTIONS = ['demand', 'user', 'session', 'backup', 'export', 'settings'];
const ACTION_OPTIONS = ['create', 'update', 'delete', 'restore', 'comment', 'login', 'login_failed', 'upload', 'export', 'update_permissions'];
const PAGE_SIZE = 100;

function getAvatarColor(name: string): string {
  const colors = ['bg-emerald-500', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-pink-500'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function relativeTime(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `há ${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function groupByDate(logs: AuditLog[]): Map<string, AuditLog[]> {
  const groups = new Map<string, AuditLog[]>();
  for (const log of logs) {
    const date = new Date(log.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(log);
  }
  return groups;
}

function formatEntityId(log: AuditLog): string {
  const id = log.entity_id || '?';
  const label = ENTITY_LABELS[log.entity_type] || log.entity_type;
  return `${label} ${id}`;
}

interface DiffField {
  label: string;
  before: string;
  after: string;
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status', priority: 'Prioridade', municipality: 'Município',
  uf: 'UF', value: 'Valor', organ: 'Órgão', responsible: 'Responsável',
  title: 'Título', description: 'Descrição', category: 'Categoria'
};

const STATUS_LABELS: Record<string, string> = {
  pendente: 'Pendente', analise: 'Em Análise', concluido: 'Concluído', rejeitado: 'Rejeitado'
};

const PRIORITY_LABELS: Record<string, string> = {
  baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente'
};

function formatFieldValue(field: string, value: any): string {
  if (value === null || value === undefined) return '—';
  if (field === 'status') return STATUS_LABELS[value] || value;
  if (field === 'priority') return PRIORITY_LABELS[value] || value;
  if (field === 'value' || field === 'requested_value') {
    const num = Number(value);
    return isNaN(num) ? String(value) : `R$ ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }
  return String(value);
}

function extractDiff(log: AuditLog): DiffField[] {
  if (log.action !== 'update') return [];
  const before = log.details?.before;
  const after = log.details?.after;
  if (!before || !after) return [];
  const fields: DiffField[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (['_browser', '_os', '_ip', 'entity_title', 'changed'].includes(key)) continue;
    const bv = formatFieldValue(key, before[key]);
    const av = formatFieldValue(key, after[key]);
    if (bv !== av) {
      fields.push({ label: FIELD_LABELS[key] || key, before: bv, after: av });
    }
  }
  return fields;
}

function formatCreateDetails(log: AuditLog): { label: string; value: string }[] {
  const after = log.details?.after;
  if (!after) return [];
  const items: { label: string; value: string }[] = [];
  if (after.status) items.push({ label: 'Status', value: formatFieldValue('status', after.status) });
  if (after.priority) items.push({ label: 'Prioridade', value: formatFieldValue('priority', after.priority) });
  if (after.municipality || after.uf) items.push({ label: 'Local', value: `${after.municipality || '?'} - ${after.uf || '?'}` });
  if (after.value || after.requested_value) items.push({ label: 'Valor', value: formatFieldValue('value', after.value || after.requested_value) });
  return items;
}

interface AuditTimelineProps {
  embedded?: boolean;
  compact?: boolean;
  maxItems?: number;
}

export default function AuditTimeline({ embedded = false, compact = false, maxItems }: AuditTimelineProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    entityType: 'all', action: 'all', dateFrom: '', dateTo: '', userName: 'all'
  });
  const [draft, setDraft] = useState(filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {
        entity_type: filters.entityType !== 'all' ? filters.entityType : undefined,
        action: filters.action !== 'all' ? filters.action : undefined,
        start_date: filters.dateFrom || undefined,
        end_date: filters.dateTo || undefined,
        search: search || undefined,
        page,
        limit: PAGE_SIZE,
      };
      const { data, pagination } = await auditApi.list(params);
      setLogs(data);
      setTotal(pagination?.total ?? data.length);
      setPages(pagination?.pages ?? 1);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar logs');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [filters, page, search]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const userNames = useMemo(() => {
    const names = new Set<string>();
    logs.forEach(l => { if (l.user_name) names.add(l.user_name); });
    return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [logs]);

  const filtered = useMemo(() => {
    if (!filters.userName || filters.userName === 'all') return logs;
    return logs.filter(l => l.user_name === filters.userName);
  }, [logs, filters.userName]);

  const displayLogs = maxItems ? filtered.slice(0, maxItems) : filtered;
  const grouped = useMemo(() => groupByDate(displayLogs), [displayLogs]);

  const activeFilterCount =
    (filters.entityType !== 'all' ? 1 : 0) +
    (filters.action !== 'all' ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0) +
    (filters.userName !== 'all' ? 1 : 0);

  const applyFilters = () => { setFilters(draft); setPage(1); setFiltersOpen(false); };
  const clearAllFilters = () => {
    const empty = { entityType: 'all', action: 'all', dateFrom: '', dateTo: '', userName: 'all' };
    setFilters(empty); setDraft(empty); setSearch(''); setPage(1);
  };

  const chips: { id: string; label: string; onRemove: () => void }[] = [];
  if (filters.entityType !== 'all') chips.push({ id: 'entityType', label: `Tipo: ${ENTITY_LABELS[filters.entityType] || filters.entityType}`, onRemove: () => { setFilters(p => ({ ...p, entityType: 'all' })); setDraft(p => ({ ...p, entityType: 'all' })); } });
  if (filters.action !== 'all') chips.push({ id: 'action', label: `Ação: ${ACTION_CONFIG[filters.action]?.label || filters.action}`, onRemove: () => { setFilters(p => ({ ...p, action: 'all' })); setDraft(p => ({ ...p, action: 'all' })); } });
  if (filters.dateFrom || filters.dateTo) chips.push({ id: 'period', label: `Período: ${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`, onRemove: () => { setFilters(p => ({ ...p, dateFrom: '', dateTo: '' })); setDraft(p => ({ ...p, dateFrom: '', dateTo: '' })); } });
  if (filters.userName !== 'all') chips.push({ id: 'userName', label: `Usuário: ${filters.userName}`, onRemove: () => { setFilters(p => ({ ...p, userName: 'all' })); setDraft(p => ({ ...p, userName: 'all' })); } });

  if (embedded) {
    return (
      <div className="space-y-0">
        {loading ? (
          <div className="space-y-4 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : displayLogs.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-4 text-center">Nenhuma atividade registrada.</p>
        ) : (
          <div className="relative pl-4">
            <div className="absolute left-[14px] top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700" />
            {displayLogs.map((log) => {
              const cfg = ACTION_CONFIG[log.action] || { verb: log.action, icon: <ScrollText size={14} />, color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', ring: '' };
              const diff = extractDiff(log);
              const createDetails = log.action === 'create' ? formatCreateDetails(log) : [];
              const entityTitle = log.details?.entity_title;
              return (
                <div key={log.id} className="relative flex items-start gap-3 py-2.5 group">
                  <div className={`absolute left-[10px] top-3 w-[10px] h-[10px] rounded-full ring-4 ${cfg.ring} ${cfg.bg} z-10 border-2 border-white dark:border-[#111a2e]`} />
                  <div className="ml-8 min-w-0">
                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                      <span className="font-bold">{log.user_name || 'Sistema'}</span>
                      <span className={`mx-1 ${cfg.color} font-semibold`}>{cfg.verb}</span>
                      {entityTitle ? (
                        <span className="font-medium text-slate-900 dark:text-white">{entityTitle}</span>
                      ) : (
                        <span className="font-mono text-slate-500">{formatEntityId(log)}</span>
                      )}
                      <span className="text-slate-400 ml-1">· {relativeTime(log.created_at)}</span>
                    </p>
                    {diff.length > 0 && (
                      <div className="mt-1.5 text-[10px] space-y-0.5">
                        {diff.map(d => (
                          <div key={d.label} className="flex items-center gap-1.5">
                            <span className="text-slate-500 font-medium">{d.label}:</span>
                            <span className="text-red-500 line-through">{d.before}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{d.after}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {createDetails.length > 0 && !diff.length && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {createDetails.map(d => (
                          <span key={d.label} className="text-[10px] text-slate-500">
                            <span className="font-medium">{d.label}:</span> {d.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl shadow-sm overflow-hidden">
      {/* Action bar */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-700/50 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
            <ScrollText size={14} className="text-emerald-600" /> Timeline de Atividades
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
            <button key={chip.id} onClick={chip.onRemove}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
            >
              {chip.label}
              <span className="p-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-red-100 hover:text-red-600 transition-colors">
                <X size={11} />
              </span>
            </button>
          ))}
          <button onClick={clearAllFilters}
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
            <RefreshCw size={14} /> Tentar novamente
          </button>
        </div>
      ) : loading ? (
        <div className="p-8 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
              <div className="flex-1 space-y-2 pt-2">
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-2/3" />
                <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center space-y-3">
          <ScrollText size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum registro encontrado.</p>
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto custom-scrollbar p-4 space-y-6">
          {Array.from(grouped.entries()).map(([date, dayLogs]) => (
            <div key={date}>
              <div className="flex items-center gap-3 mb-3">
                <h4 className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest whitespace-nowrap">
                  {date}
                </h4>
                <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
              </div>
              <div className="relative pl-4">
                <div className="absolute left-[14px] top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700" />
                {dayLogs.map((log) => {
                  const cfg = ACTION_CONFIG[log.action] || { verb: log.action, icon: <ScrollText size={14} />, color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', ring: '', label: log.action };
                  const diff = extractDiff(log);
                  const createDetails = log.action === 'create' ? formatCreateDetails(log) : [];
                  const entityTitle = log.details?.entity_title;
                  const isExpanded = expandedIds.has(log.id);
                  const initials = (log.user_name || 'S').slice(0, 2).toUpperCase();
                  const avatarBg = getAvatarColor(log.user_name || 'system');

                  return (
                    <div key={log.id} className="relative flex items-start gap-3 py-3 group">
                      {/* Avatar */}
                      <div className={`absolute left-0 top-3 w-[28px] h-[28px] rounded-full ${avatarBg} flex items-center justify-center text-[9px] font-black text-white z-10 ring-4 ring-white dark:ring-[#111a2e] shadow-sm`}>
                        {initials}
                      </div>

                      <div className="ml-10 min-w-0 flex-1">
                        {/* Header line */}
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                            <span className="font-bold text-slate-900 dark:text-white">{log.user_name || 'Sistema'}</span>
                            <span className={`mx-1.5 ${cfg.color} font-semibold`}>{cfg.verb}</span>
                            {entityTitle ? (
                              <span className="font-semibold text-slate-900 dark:text-white">{entityTitle}</span>
                            ) : (
                              <span className="font-mono text-slate-500 text-[10px]">{formatEntityId(log)}</span>
                            )}
                          </p>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-0.5">
                            {relativeTime(log.created_at)}
                          </span>
                        </div>

                        {/* Action badge */}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${cfg.bg} ${cfg.color}`}>
                            {cfg.icon}
                            {cfg.label}
                          </span>
                          {entityTitle && (
                            <span className="text-[10px] font-mono text-slate-400">{log.entity_id}</span>
                          )}
                        </div>

                        {/* Before/After diff */}
                        {diff.length > 0 && (
                          <div className="mt-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50 p-2.5 space-y-1">
                            {diff.map(d => (
                              <div key={d.label} className="flex items-center gap-2 text-[10px]">
                                <span className="text-slate-500 font-semibold min-w-[70px]">{d.label}</span>
                                <span className="text-red-500 line-through bg-red-50 dark:bg-red-950/30 px-1.5 rounded">{d.before}</span>
                                <span className="text-slate-400">→</span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-950/30 px-1.5 rounded">{d.after}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Create details */}
                        {createDetails.length > 0 && !diff.length && (
                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                            {createDetails.map(d => (
                              <span key={d.label} className="text-[10px] text-slate-500">
                                <span className="font-semibold">{d.label}:</span> {d.value}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Expandable: IP/Browser */}
                        {(log.ip_address || log.details?._browser) && (
                          <div className="mt-1.5">
                            <button onClick={() => toggleExpand(log.id)}
                              className="inline-flex items-center gap-1 text-[9px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                            >
                              {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                              {isExpanded ? 'Ocultar detalhes' : 'Detalhes técnicos'}
                            </button>
                            {isExpanded && (
                              <div className="mt-1 flex items-center gap-3 text-[9px] text-slate-400 font-mono">
                                {log.ip_address && (
                                  <span className="flex items-center gap-1">
                                    <Globe size={10} />
                                    {log.ip_address}
                                  </span>
                                )}
                                {log.details?._browser && (
                                  <span className="flex items-center gap-1">
                                    <Monitor size={10} />
                                    {log.details._browser} / {log.details._os}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!embedded && pages > 1 && (
        <div className="p-3 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            Página {page} de {pages} · {total} registros
          </span>
          <div className="flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-2.5 py-1 rounded-lg border text-[10px] font-bold border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Anterior
            </button>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}
              className="px-2.5 py-1 rounded-lg border text-[10px] font-bold border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      <FiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} onApply={applyFilters} onClear={() => setDraft({ entityType: 'all', action: 'all', dateFrom: '', dateTo: '', userName: 'all' })}>
        <Select label="Tipo de Entidade" value={draft.entityType} onChange={e => setDraft(prev => ({ ...prev, entityType: e.target.value }))}>
          <option value="all">Todos os tipos</option>
          {ENTITY_OPTIONS.map(t => <option key={t} value={t}>{ENTITY_LABELS[t] || t}</option>)}
        </Select>
        <Select label="Ação" value={draft.action} onChange={e => setDraft(prev => ({ ...prev, action: e.target.value }))}>
          <option value="all">Todas as ações</option>
          {ACTION_OPTIONS.map(a => <option key={a} value={a}>{ACTION_CONFIG[a]?.label || a}</option>)}
        </Select>
        <Select label="Usuário" value={draft.userName} onChange={e => setDraft(prev => ({ ...prev, userName: e.target.value }))}>
          <option value="all">Todos os usuários</option>
          {userNames.map(u => <option key={u} value={u}>{u}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data Início" type="date" value={draft.dateFrom} onChange={e => setDraft(prev => ({ ...prev, dateFrom: e.target.value }))} />
          <Input label="Data Fim" type="date" value={draft.dateTo} onChange={e => setDraft(prev => ({ ...prev, dateTo: e.target.value }))} />
        </div>
      </FiltersDrawer>
    </div>
  );
}

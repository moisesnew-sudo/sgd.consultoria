import React, { useState, useMemo, useEffect } from 'react';
import {
  BarChart3, Download, TrendingUp, AlertTriangle, CheckCircle2, Clock, FileText, Sparkles,
  Search, X, SlidersHorizontal, Check, FilterX, FileJson
} from 'lucide-react';
import { Demand, DemandStatus } from '../types';
import { formatCurrency } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ExecutiveReport from './ExecutiveReport';
import ExportMenu, { ExportMenuItem } from './ui/ExportMenu';

interface ReportsViewProps {
  demands: Demand[];
}

const STATUS_LABELS: Record<DemandStatus, string> = {
  pendente: 'Pendente',
  analise: 'Em Análise',
  concluido: 'Concluído',
  rejeitado: 'Rejeitado'
};

const PRIORITY_LABELS: Record<string, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  urgente: 'Urgente'
};

export default function ReportsView({ demands }: ReportsViewProps) {
  const { user, hasPermission } = useAuth();
  const canEmit = hasPermission('reports.emit');
  const canExport = hasPermission('reports.export');
  const [filters, setFilters] = useState({
    search: '', uf: '', municipality: '', organ: '', proposal: '', object: '',
    status: '', priority: '', ano: '',
    createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
    valueMin: '', valueMax: '', responsible: '',
  });
  const [reportType, setReportType] = useState('executivo');

  const setFilter = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters(prev => ({ ...prev, [key]: e.target.value }));
  };

  const activeFilterCount = Object.values(filters).filter(v => String(v ?? '').trim() !== '').length;

  const clearFilters = () => setFilters({
    search: '', uf: '', municipality: '', organ: '', proposal: '', object: '',
    status: '', priority: '', ano: '',
    createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
    valueMin: '', valueMax: '', responsible: '',
  });

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [draft, setDraft] = useState({ ...filters });

  useEffect(() => {
    if (!isFiltersOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFilters(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFiltersOpen]);

  const openFilters = () => {
    setDraft({ ...filters });
    setIsFiltersOpen(true);
  };
  const closeFilters = () => setIsFiltersOpen(false);
  const applyFilters = () => {
    setFilters({ ...draft });
    setIsFiltersOpen(false);
  };
  const setDraftFilter = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setDraft(prev => ({ ...prev, [key]: e.target.value }));
  };
  const clearDraftFilters = () => {
    setDraft({
      search: '', uf: '', municipality: '', organ: '', proposal: '', object: '',
      status: '', priority: '', ano: '',
      createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
      valueMin: '', valueMax: '', responsible: '',
    });
  };
  const setFilterValue = (key: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const filtered = useMemo(() => {
    const f = filters;
    return demands.filter(d => {
      const q = f.search.trim().toLowerCase();
      if (q && ![d.id, d.title, d.municipality, d.description, d.category, d.organ, d.proposal_number, d.prefeitura, d.responsible_name, d.notes, d.uf]
        .some(x => String(x ?? '').toLowerCase().includes(q))) return false;
      if (f.uf && d.uf !== f.uf) return false;
      if (f.municipality && d.municipality !== f.municipality) return false;
      if (f.organ && d.organ !== f.organ) return false;
      if (f.proposal && !String(d.proposal_number || '').toUpperCase().includes(f.proposal.trim().toUpperCase())) return false;
      if (f.object && !String(d.title || '').toUpperCase().includes(f.object.trim().toUpperCase())) return false;
      if (f.status && d.status !== f.status) return false;
      if (f.priority && d.priority !== f.priority) return false;
      if (f.ano && String(d.ano ?? '') !== f.ano) return false;
      if (f.responsible && d.responsible_name !== f.responsible) return false;
      const created = new Date(d.created_at).getTime();
      if (f.createdFrom && created < new Date(`${f.createdFrom}T00:00:00`).getTime()) return false;
      if (f.createdTo && created > new Date(`${f.createdTo}T23:59:59`).getTime()) return false;
      const updated = new Date(d.updated_at || d.created_at).getTime();
      if (f.updatedFrom && updated < new Date(`${f.updatedFrom}T00:00:00`).getTime()) return false;
      if (f.updatedTo && updated > new Date(`${f.updatedTo}T23:59:59`).getTime()) return false;
      const value = Number(d.requested_value || 0);
      if (f.valueMin !== '' && value < Number(f.valueMin)) return false;
      if (f.valueMax !== '' && value > Number(f.valueMax)) return false;
      return true;
    });
  }, [demands, filters]);

  const totalRequested = filtered.reduce((sum, d) => sum + Number(d.requested_value || 0), 0);
  const totalApproved = filtered
    .filter(d => ['analise', 'concluido'].includes(d.status))
    .reduce((sum, d) => sum + Number(d.requested_value || 0), 0);

  const byStatus = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    for (const d of filtered) {
      if (!map[d.status]) map[d.status] = { count: 0, value: 0 };
      map[d.status].count += 1;
      map[d.status].value += Number(d.requested_value || 0);
    }
    return map;
  }, [filtered]);

  const byUf = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    for (const d of filtered) {
      if (!map[d.uf]) map[d.uf] = { count: 0, value: 0 };
      map[d.uf].count += 1;
      map[d.uf].value += Number(d.requested_value || 0);
    }
    return Object.entries(map)
      .sort((a, b) => b[1].value - a[1].value);
  }, [filtered]);

  const byPriority = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of filtered) {
      map[d.priority] = (map[d.priority] || 0) + 1;
    }
    return map;
  }, [filtered]);

  const ufs = [...new Set(demands.map(d => d.uf))].sort();
  const municipalities = [...new Set(demands.map(d => d.municipality).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const organs = [...new Set(demands.map(d => d.organ).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const responsibles = [...new Set(demands.map(d => d.responsible_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const years = [...new Set(demands.map(d => d.ano).filter((y): y is number => Boolean(y)))].sort((a, b) => b - a);

  const [showReport, setShowReport] = useState(false);

  const handleExportCsv = () => {
    const esc = (v: any) => {
      const s = String(v ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };
    const headers = ['ID', 'Título', 'Município', 'UF', 'Ano', 'Status', 'Prioridade', 'Valor Solicitado', 'Órgão'];
    const rows = filtered.map(d => [
      esc(d.id), esc(d.title), esc(d.municipality), esc(d.uf), esc(d.ano || ''),
      esc(STATUS_LABELS[d.status]),
      esc(PRIORITY_LABELS[d.priority] || d.priority), esc(d.requested_value || 0), esc(d.organ || '')
    ]);
    const bom = '\uFEFF';
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_sgd_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_sgd_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportItems: ExportMenuItem[] = [
    {
      id: 'csv',
      label: 'Exportar CSV',
      description: 'Dados filtrados (.csv)',
      icon: <FileText size={16} className="text-emerald-600 dark:text-emerald-400" />,
      onSelect: () => { handleExportCsv(); },
    },
    {
      id: 'json',
      label: 'Exportar JSON',
      description: 'Dados filtrados (.json)',
      icon: <FileJson size={16} className="text-blue-600 dark:text-blue-400" />,
      onSelect: () => { handleExportJson(); },
    },
  ];

  const chipDefs: Array<[keyof typeof filters, string]> = [
    ['search', `Busca: ${filters.search}`],
    ['uf', `UF: ${filters.uf}`],
    ['municipality', `Município: ${filters.municipality}`],
    ['organ', `Órgão: ${filters.organ}`],
    ['proposal', `Proposta: ${filters.proposal}`],
    ['object', `Objeto: ${filters.object}`],
    ['status', `Status: ${STATUS_LABELS[filters.status as DemandStatus] || filters.status}`],
    ['priority', `Prioridade: ${PRIORITY_LABELS[filters.priority] || filters.priority}`],
    ['ano', `Ano: ${filters.ano}`],
    ['createdFrom', `Cadastro de: ${filters.createdFrom}`],
    ['createdTo', `Cadastro até: ${filters.createdTo}`],
    ['updatedFrom', `Atualização de: ${filters.updatedFrom}`],
    ['updatedTo', `Atualização até: ${filters.updatedTo}`],
    ['valueMin', `Valor mín.: ${filters.valueMin}`],
    ['valueMax', `Valor máx.: ${filters.valueMax}`],
    ['responsible', `Responsável: ${filters.responsible}`],
  ];
  const activeChips = chipDefs
    .filter(([k]) => String(filters[k] ?? '').trim() !== '')
    .map(([k, label]) => ({ id: k, label, onRemove: () => setFilterValue(k, '') }));

  const clearAllFilters = () => {
    clearFilters();
    setIsFiltersOpen(false);
  };

  const maxBarValue = byUf.length > 0 ? Math.max(...byUf.map(([, v]) => v.value), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="text-brand-700 dark:text-brand-400" size={26} />
            Relatórios e Análises
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Dados consolidados de {filtered.length} demandas
          </p>
        </div>
      </div>

      {/* ACTION BAR */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-3 shadow-sm flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={filters.search}
            onChange={setFilter('search')}
            placeholder="Pesquisa: ID, proposta, objeto, município, órgão, responsável..."
            className="w-full pl-10 pr-8 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
          />
          {filters.search && (
            <button
              onClick={() => setFilterValue('search', '')}
              aria-label="Limpar pesquisa"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={openFilters}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-colors relative ${
              activeFilterCount > 0
                ? 'bg-brand-50 dark:bg-brand-950/30 border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-300'
                : 'bg-white dark:bg-[#111a2e] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal size={15} />
            Filtros
            {activeFilterCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[9px] font-black flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {canExport && (
            <ExportMenu
              items={exportItems}
              buttonLabel="Exportar"
              buttonIcon={<Download size={15} />}
            />
          )}

          {canEmit && (
            <>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:ring-2 focus:ring-brand-600 focus:outline-none"
                title="Tipo de Relatório"
              >
                <option value="executivo">Executivo Geral (IA)</option>
                <option value="municipio">Por Município</option>
                <option value="estado">Por Estado</option>
                <option value="orgao">Por Órgão</option>
              </select>
              <button
                onClick={() => setShowReport(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white text-xs font-bold uppercase tracking-wider cursor-pointer shadow-sm"
              >
                <Sparkles size={14} /> Gerar Relatório
              </button>
            </>
          )}
        </div>
      </div>

      {/* ACTIVE FILTER CHIPS */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map(chip => (
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

      {/* FILTERS DRAWER */}
      {isFiltersOpen && draft && (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs animate-fade-in" onClick={closeFilters} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Filtros de relatórios"
            className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-[#111a2e] shadow-2xl animate-drawer flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700/50 shrink-0">
              <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-brand-600" /> Filtros
              </h3>
              <button
                onClick={closeFilters}
                aria-label="Fechar filtros"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Palavra-chave */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">Palavra-chave</label>
                <input
                  type="text"
                  value={draft.search}
                  onChange={setDraftFilter('search')}
                  placeholder="ID, proposta, objeto, município, órgão, responsável..."
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              {/* Localização */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest block">Localização</label>
                <select value={draft.uf} onChange={setDraftFilter('uf')} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Todas as UFs</option>
                  {ufs.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
                <select value={draft.municipality} onChange={setDraftFilter('municipality')} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Todos os Municípios</option>
                  {municipalities.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              {/* Dados da Proposta */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest block">Dados da Proposta</label>
                <select value={draft.organ} onChange={setDraftFilter('organ')} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Todos os Órgãos</option>
                  {organs.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <input type="text" value={draft.proposal} onChange={setDraftFilter('proposal')} placeholder="Número da proposta (ex.: 2025.0001)"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                <input type="text" value={draft.object} onChange={setDraftFilter('object')} placeholder="Objeto da demanda (texto)"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                <select value={draft.ano} onChange={setDraftFilter('ano')} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Todos os Anos</option>
                  {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                </select>
              </div>

              {/* Situação */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest block">Situação</label>
                <select value={draft.status} onChange={setDraftFilter('status')} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Todas as Situações</option>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={draft.priority} onChange={setDraftFilter('priority')} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Todas as Prioridades</option>
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {/* Datas */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest block">Datas</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">Cadastro de</label>
                    <input type="date" value={draft.createdFrom} onChange={setDraftFilter('createdFrom')} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">até</label>
                    <input type="date" value={draft.createdTo} onChange={setDraftFilter('createdTo')} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">Atualização de</label>
                    <input type="date" value={draft.updatedFrom} onChange={setDraftFilter('updatedFrom')} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">até</label>
                    <input type="date" value={draft.updatedTo} onChange={setDraftFilter('updatedTo')} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                </div>
              </div>

              {/* Valores */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest block">Valores</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">Valor mín. (R$)</label>
                    <input type="number" min="0" step="0.01" value={draft.valueMin} onChange={setDraftFilter('valueMin')} placeholder="0,00"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">Valor máx. (R$)</label>
                    <input type="number" min="0" step="0.01" value={draft.valueMax} onChange={setDraftFilter('valueMax')} placeholder="0,00"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                </div>
                <p className="text-[9px] text-slate-400 dark:text-slate-500">Faixa de valor global da demanda.</p>
              </div>

              {/* Usuário */}
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest block">Usuário</label>
                <select value={draft.responsible} onChange={setDraftFilter('responsible')} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-700 dark:text-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Todos os Responsáveis</option>
                  {responsibles.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <p className="text-[9px] text-slate-400 dark:text-slate-500">Responsável / usuário pelo cadastro.</p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700/50 flex gap-2 shrink-0">
              <button
                onClick={clearDraftFilters}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                <FilterX size={14} /> Limpar
              </button>
              <button
                onClick={applyFilters}
                className="flex-1 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-1.5"
              >
                <Check size={14} /> Aplicar
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400">
              <FileText size={20} />
            </div>
            <p className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Total Demandas</p>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white">{filtered.length}</p>
        </div>

        <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-brand-50 dark:bg-brand-900/30 rounded-xl flex items-center justify-center text-brand-600 dark:text-brand-400">
              <TrendingUp size={20} />
            </div>
            <p className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Valor Solicitado</p>
          </div>
          <p className="text-xl font-black text-slate-900 dark:text-white">{formatCurrency(totalRequested)}</p>
        </div>

        <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-50 dark:bg-green-900/30 rounded-xl flex items-center justify-center text-green-600 dark:text-green-400">
              <CheckCircle2 size={20} />
            </div>
            <p className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Em Andamento/Concluído</p>
          </div>
          <p className="text-xl font-black text-slate-900 dark:text-white">{formatCurrency(totalApproved)}</p>
        </div>

        <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/30 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400">
              <AlertTriangle size={20} />
            </div>
            <p className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Taxa Sucesso</p>
          </div>
          <p className="text-xl font-black text-slate-900 dark:text-white">
            {filtered.length > 0
              ? `${Math.round(((byStatus['analise']?.count || 0) + (byStatus['concluido']?.count || 0)) / filtered.length * 100)}%`
              : '0%'
            }
          </p>
        </div>
      </div>

      {/* By Status */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">Demandas por Status</h3>
        <div className="space-y-3">
          {Object.entries(STATUS_LABELS).map(([key, label]) => {
            const item = byStatus[key] || { count: 0, value: 0 };
            const pct = filtered.length > 0 ? Math.round((item.count / filtered.length) * 100) : 0;
            const colors: Record<string, string> = {
              pendente: 'bg-amber-500',
              analise: 'bg-blue-500',
              concluido: 'bg-green-500',
              rejeitado: 'bg-red-400'
            };
            return (
              <div key={key} className="flex items-center gap-4">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 w-32 shrink-0">{label}</span>
                <div className="flex-1 h-6 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${colors[key] || 'bg-slate-300'} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 w-12 text-right">{item.count}</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 w-28 text-right font-mono">
                  {formatCurrency(item.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* By UF */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">Valor por Estado (Top 10)</h3>
        <div className="space-y-3">
          {byUf.slice(0, 10).map(([uf, data]) => {
            const pct = (data.value / maxBarValue) * 100;
            return (
              <div key={uf} className="flex items-center gap-4">
                <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-200 w-8 text-center shrink-0">{uf}</span>
                <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 w-8 text-right">{data.count}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 w-28 text-right font-mono">
                  {formatCurrency(data.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* By Priority */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">Distribuição por Prioridade</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(['baixa', 'media', 'alta', 'urgente'] as const).map(pri => {
            const count = byPriority[pri] || 0;
            const pct = filtered.length > 0 ? Math.round((count / filtered.length) * 100) : 0;
            const colors: Record<string, { bg: string; text: string; border: string }> = {
              baixa: { bg: 'bg-slate-50 dark:bg-slate-800/50', text: 'text-slate-600 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-600' },
              media: { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800' },
              alta: { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
              urgente: { bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400', border: 'border-red-200 dark:border-red-800' }
            };
            const c = colors[pri];
            return (
              <div key={pri} className={`${c.bg} border ${c.border} rounded-2xl p-4 text-center`}>
                <p className={`text-3xl font-black ${c.text}`}>{count}</p>
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mt-1">{PRIORITY_LABELS[pri]}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-1">{pct}%</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Table */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700/50">
          <h3 className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Últimas 10 Demandas Filtradas</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/50">
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">ID</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Título</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Município</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ano</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 10).map((d) => (
                <tr key={d.id} className="border-t border-slate-100/50 dark:border-slate-700/30 hover:bg-slate-50/30 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3 text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300">{d.id}</td>
                  <td className="px-5 py-3 text-xs font-bold text-slate-800 dark:text-slate-100 max-w-[200px] truncate">{d.title}</td>
                  <td className="px-5 py-3 text-xs text-slate-600 dark:text-slate-300">{d.municipality} - {d.uf}</td>
                  <td className="px-5 py-3 text-xs font-mono text-slate-500 dark:text-slate-400">{d.ano || '—'}</td>
                  <td className="px-5 py-3">
                    <span className="inline-block px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-[9px] font-bold text-slate-600 dark:text-slate-200 uppercase">
                      {STATUS_LABELS[d.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs font-mono font-bold text-slate-800 dark:text-white text-right">
                    {formatCurrency(d.requested_value || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-8">
            <Clock className="mx-auto text-slate-300 dark:text-slate-600 mb-2" size={24} />
            <p className="text-sm text-slate-400 dark:text-slate-500 font-semibold">Nenhum dado encontrado</p>
          </div>
        )}
      </div>

      {showReport && (
        <ExecutiveReport
          demands={filtered}
          filters={{
            search: filters.search,
            uf: filters.uf,
            municipality: filters.municipality,
            organ: filters.organ,
            proposal: filters.proposal,
            object: filters.object,
            status: filters.status,
            priority: filters.priority,
            ano: filters.ano,
            responsible: filters.responsible,
            createdFrom: filters.createdFrom,
            createdTo: filters.createdTo,
            updatedFrom: filters.updatedFrom,
            updatedTo: filters.updatedTo,
            valueMin: filters.valueMin,
            valueMax: filters.valueMax,
          }}
          reportType={reportType}
          userLabel={user?.name || 'Administrador'}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
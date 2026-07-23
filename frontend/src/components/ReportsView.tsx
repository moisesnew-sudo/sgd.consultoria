import React, { useState, useMemo } from 'react';
import {
  BarChart3, Download, Filter, TrendingUp, AlertTriangle, CheckCircle2, Clock, FileText, Sparkles
} from 'lucide-react';
import { Demand, DemandStatus } from '../types';
import { demandsApi, formatCurrency } from '../services/api';
import ExecutiveReport from './ExecutiveReport';

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
  const [filterUf, setFilterUf] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAno, setFilterAno] = useState('');

  const filtered = useMemo(() => {
    return demands.filter(d => {
      if (filterUf && d.uf !== filterUf) return false;
      if (filterStatus && d.status !== filterStatus) return false;
      if (filterPriority && d.priority !== filterPriority) return false;
      if (filterAno && String(d.ano ?? '') !== filterAno) return false;
      return true;
    });
  }, [demands, filterUf, filterStatus, filterPriority, filterAno]);

  const totalRequested = filtered.reduce((sum, d) => sum + (d.requested_value || 0), 0);
  const totalApproved = filtered
    .filter(d => ['analise', 'concluido'].includes(d.status))
    .reduce((sum, d) => sum + (d.requested_value || 0), 0);

  const byStatus = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    for (const d of filtered) {
      if (!map[d.status]) map[d.status] = { count: 0, value: 0 };
      map[d.status].count += 1;
      map[d.status].value += d.requested_value || 0;
    }
    return map;
  }, [filtered]);

  const byUf = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    for (const d of filtered) {
      if (!map[d.uf]) map[d.uf] = { count: 0, value: 0 };
      map[d.uf].count += 1;
      map[d.uf].value += d.requested_value || 0;
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

  const [showReport, setShowReport] = useState(false);

  const handleExportCsv = () => {
    const headers = ['ID', 'Título', 'Município', 'UF', 'Ano', 'Status', 'Prioridade', 'Valor Solicitado', 'Órgão'];
    const rows = filtered.map(d => [
      d.id, `"${d.title}"`, `"${d.municipality}"`, d.uf, d.ano || '',
      STATUS_LABELS[d.status],
      PRIORITY_LABELS[d.priority] || d.priority, d.requested_value || 0, `"${d.organ || ''}"`
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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

  const maxBarValue = byUf.length > 0 ? Math.max(...byUf.map(([, v]) => v.value), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <BarChart3 className="text-indigo-950" size={26} />
            Relatórios e Análises
          </h2>
          <p className="text-sm text-slate-500">
            Dados consolidados de {filtered.length} demandas
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            <Sparkles size={14} /> RELATÓRIO
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            <Download size={14} /> CSV
          </button>
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-indigo-950 text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            <Download size={14} /> JSON
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Filter size={14} className="text-slate-400" />
          <select value={filterUf} onChange={(e) => setFilterUf(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-blue-600 focus:outline-none">
            <option value="">Todas UFs</option>
            {ufs.map(uf => <option key={uf} value={uf}>{uf}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-blue-600 focus:outline-none">
            <option value="">Todos Status</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-blue-600 focus:outline-none">
            <option value="">Todas Prioridades</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={filterAno} onChange={(e) => setFilterAno(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-blue-600 focus:outline-none">
            <option value="">Todos Anos</option>
            {[2020,2021,2022,2023,2024,2025,2026,2027,2028,2029,2030].map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          {(filterUf || filterStatus || filterPriority || filterAno) && (
            <button onClick={() => { setFilterUf(''); setFilterStatus(''); setFilterPriority(''); setFilterAno(''); }}
              className="text-[10px] text-red-500 font-bold hover:underline cursor-pointer">
              Limpar Filtros
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
              <FileText size={20} />
            </div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Total Demandas</p>
          </div>
          <p className="text-3xl font-black text-slate-900">{filtered.length}</p>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
              <TrendingUp size={20} />
            </div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Valor Solicitado</p>
          </div>
          <p className="text-xl font-black text-slate-900">{formatCurrency(totalRequested)}</p>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-green-600">
              <CheckCircle2 size={20} />
            </div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Em Andamento/Concluído</p>
          </div>
          <p className="text-xl font-black text-slate-900">{formatCurrency(totalApproved)}</p>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
              <AlertTriangle size={20} />
            </div>
            <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Taxa Sucesso</p>
          </div>
          <p className="text-xl font-black text-slate-900">
            {filtered.length > 0
              ? `${Math.round(((byStatus['analise']?.count || 0) + (byStatus['concluido']?.count || 0)) / filtered.length * 100)}%`
              : '0%'
            }
          </p>
        </div>
      </div>

      {/* By Status */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-extrabold text-slate-500 uppercase tracking-widest mb-4">Demandas por Status</h3>
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
                <span className="text-xs font-semibold text-slate-600 w-32 shrink-0">{label}</span>
                <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${colors[key] || 'bg-slate-300'} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-slate-700 w-12 text-right">{item.count}</span>
                <span className="text-[10px] text-slate-400 w-28 text-right font-mono">
                  {formatCurrency(item.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* By UF */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-extrabold text-slate-500 uppercase tracking-widest mb-4">Valor por Estado (Top 10)</h3>
        <div className="space-y-3">
          {byUf.slice(0, 10).map(([uf, data]) => {
            const pct = (data.value / maxBarValue) * 100;
            return (
              <div key={uf} className="flex items-center gap-4">
                <span className="text-xs font-mono font-bold text-slate-700 w-8 text-center shrink-0">{uf}</span>
                <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-slate-600 w-8 text-right">{data.count}</span>
                <span className="text-[10px] text-slate-500 w-28 text-right font-mono">
                  {formatCurrency(data.value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* By Priority */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
        <h3 className="text-xs font-extrabold text-slate-500 uppercase tracking-widest mb-4">Distribuição por Prioridade</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(['baixa', 'media', 'alta', 'urgente'] as const).map(pri => {
            const count = byPriority[pri] || 0;
            const pct = filtered.length > 0 ? Math.round((count / filtered.length) * 100) : 0;
            const colors: Record<string, { bg: string; text: string; border: string }> = {
              baixa: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
              media: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
              alta: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
              urgente: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' }
            };
            const c = colors[pri];
            return (
              <div key={pri} className={`${c.bg} border ${c.border} rounded-2xl p-4 text-center`}>
                <p className={`text-3xl font-black ${c.text}`}>{count}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase mt-1">{PRIORITY_LABELS[pri]}</p>
                <p className="text-xs text-slate-400 font-mono mt-1">{pct}%</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Table */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-xs font-extrabold text-slate-500 uppercase tracking-widest">Últimas 10 Demandas Filtradas</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/80">
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">ID</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Título</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Município</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Ano</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 10).map((d) => (
                <tr key={d.id} className="border-t border-slate-100/50 hover:bg-slate-50/30 transition-colors">
                  <td className="px-5 py-3 text-[10px] font-mono font-bold text-slate-600">{d.id}</td>
                  <td className="px-5 py-3 text-xs font-bold text-slate-800 max-w-[200px] truncate">{d.title}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">{d.municipality} - {d.uf}</td>
                  <td className="px-5 py-3 text-xs font-mono text-slate-500">{d.ano || '—'}</td>
                  <td className="px-5 py-3">
                    <span className="inline-block px-2 py-1 rounded-md bg-slate-100 text-[9px] font-bold text-slate-600 uppercase">
                      {STATUS_LABELS[d.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs font-mono font-bold text-slate-800 text-right">
                    {formatCurrency(d.requested_value || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-8">
            <Clock className="mx-auto text-slate-300 mb-2" size={24} />
            <p className="text-sm text-slate-400 font-semibold">Nenhum dado encontrado</p>
          </div>
        )}
      </div>

      {showReport && (
        <ExecutiveReport
          demands={filtered}
          filters={{ uf: filterUf, status: filterStatus, priority: filterPriority, ano: filterAno }}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import { UploadCloud, Download, FileText, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Demand } from '../types';
import { demandsApi, formatDate, logExport } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { LOGO_B64 } from './reports/logoBase64';

interface FiltersState {
  search?: string;
  status?: string;
  priority?: string;
  category?: string;
  uf?: string;
  responsible?: string;
  ano?: string;
  dateFrom?: string;
  dateTo?: string;
  valueMin?: string;
  valueMax?: string;
}

interface ImportExportBarProps {
  rows: Demand[];
  filters?: FiltersState;
  onImported: (created: Demand[]) => void;
}

const EXPECTED_HEADERS: Record<string, keyof Demand> = {
  'titulo': 'title',
  'objeto': 'title',
  'descricao': 'description',
  'categoria': 'category',
  'status': 'status',
  'prioridade': 'priority',
  'municipio': 'municipality',
  'uf': 'uf',
  'valor': 'requested_value',
  'valor_solicitado': 'requested_value',
  'orgao': 'organ',
  'prefeitura': 'prefeitura',
  'proposta': 'proposal_number',
  'link': 'process_link',
  'responsavel': 'responsible_name',
  'email': 'responsible_email',
  'telefone': 'responsible_phone',
  'observacoes': 'notes',
  'ano': 'ano',
};

function mapRow(row: any): Partial<Demand> | null {
  const mapped: any = {};
  let found = false;
  for (const [key, value] of Object.entries(row)) {
    const k = String(key).trim().toLowerCase();
    const target = EXPECTED_HEADERS[k];
    if (target) {
      mapped[target] = value;
      found = true;
    }
  }
  if (!mapped.title || !mapped.municipality || !mapped.uf) return null;
  mapped.requested_value = Number(mapped.requested_value) || 0;
  mapped.ano = mapped.ano != null ? Number(mapped.ano) : undefined;
  mapped.category = mapped.category || mapped.title.substring(0, 30);
  mapped.status = mapped.status || 'pendente';
  mapped.priority = mapped.priority || 'media';
  for (const f of ['title', 'municipality', 'organ', 'prefeitura', 'proposal_number', 'responsible_name', 'category', 'description', 'notes'] as const) {
    if (mapped[f]) mapped[f] = String(mapped[f]).toUpperCase();
  }
  if (mapped.uf) mapped.uf = String(mapped.uf).toUpperCase();
  if (mapped.responsible_email) mapped.responsible_email = String(mapped.responsible_email).toLowerCase();
  return mapped as Partial<Demand>;
}

const fmtCurrency = (v: number): string => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
};

export default function ImportExportBar({ rows, filters, onImported }: ImportExportBarProps) {
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const canExportExcel = hasPermission('demands.export_excel');
  const canExportPdf = hasPermission('demands.export_pdf');
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: number; fail: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseFile = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array', codepage: 65001 });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      const valid = json.map(mapRow).filter(Boolean) as Partial<Demand>[];
      let ok = 0;
      let fail = 0;
      const created: Demand[] = [];
      for (const item of valid) {
        try {
          const d = await demandsApi.create(item);
          created.push(d);
          ok++;
        } catch {
          fail++;
        }
      }
      setImportResult({ ok, fail });
      if (created.length) onImported(created);
    } catch (e: any) {
      toast('error', 'Erro ao ler arquivo', e?.message || 'formato inválido');
    } finally {
      setImporting(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (files && files.length) parseFile(files[0]);
  };

  const exportExcel = () => {
    const up = (v: any) => String(v ?? '').toUpperCase();
    const data = rows.map(d => ({
      ID: d.id,
      Título: up(d.title),
      Município: up(d.municipality),
      UF: d.uf,
      'Ano': d.ano || '',
      Status: d.status,
      Prioridade: d.priority,
      Categoria: up(d.category),
      Valor: d.requested_value,
      Órgão: up(d.organ || ''),
      Proposta: up(d.proposal_number || ''),
      Responsável: up(d.responsible_name || ''),
      'Criado em': formatDate(d.created_at),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Demandas');
    XLSX.writeFile(wb, `sgd-demandas-${new Date().toISOString().slice(0, 10)}.xlsx`);
    logExport('excel', rows.length, filters);
  };

  const exportCsv = () => {
    const headers = ['ID', 'Título', 'Município', 'UF', 'Ano', 'Status', 'Prioridade', 'Categoria', 'Valor', 'Órgão', 'Proposta', 'Responsável', 'Criado em'];
    const up = (v: any) => String(v ?? '').toUpperCase();
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map(d => [
      d.id, up(d.title), up(d.municipality), d.uf, d.ano || '', d.status, d.priority, up(d.category),
      d.requested_value, up(d.organ || ''), up(d.proposal_number || ''), up(d.responsible_name || ''), formatDate(d.created_at)
    ].map(escape).join(','));
    const csv = '\uFEFF' + [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sgd-demandas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const { buildPdfReport } = await import('./reports/pdfAutoReport');
    await buildPdfReport({
      demands: rows,
      filters: filters as FiltersState,
      userLabel: user?.name || '—',
      mode: 'compact',
      fileName: `sgd-demandas-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
    logExport('pdf', rows.length, filters);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <UploadCloud size={15} /> Importar
        </button>
        <div className="relative group">
          <button
            onClick={exportExcel}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors"
          >
            <Download size={15} /> Exportar
          </button>
          <div className="absolute right-0 top-full mt-1 min-w-[180px] bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 hidden group-hover:block overflow-hidden">
            {canExportExcel && (
              <button
                onClick={exportExcel}
                className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50"
              >
                <FileText size={14} className="text-green-600" /> Exportar Excel
              </button>
            )}
            {canExportPdf && (
              <button
                onClick={exportPdf}
                className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
              >
                <FileText size={14} className="text-red-600" /> Exportar PDF
              </button>
            )}
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fade-in" onClick={() => setIsOpen(false)}>
          <div className="w-full max-w-lg bg-white dark:bg-[#111a2e] rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700/50 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700/50">
              <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <UploadCloud size={18} className="text-brand-600" /> Importar Demandas
              </h3>
              <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                  isDragging ? 'border-brand-500 bg-brand-50/50' : 'border-slate-300 dark:border-slate-600 hover:border-brand-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <UploadCloud size={32} className="mx-auto text-brand-500 mb-3" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Arraste o arquivo aqui ou clique para selecionar</p>
                <p className="text-[11px] text-slate-400 mt-1">Formatos: Excel (.xlsx/.xls) ou CSV — UTF-8</p>
              </div>

              <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-100 dark:border-slate-700/50">
                <p className="font-bold text-slate-600 dark:text-slate-300 mb-1">Colunas aceitas (cabeçalho da 1ª linha):</p>
                <p className="font-mono leading-relaxed">titulo, descricao, categoria, status, prioridade, municipio, uf, valor, orgao, prefeitura, proposta, link, responsavel, email, telefone, observacoes</p>
                <p className="mt-1">Obrigatórias: <strong>titulo</strong>, <strong>municipio</strong>, <strong>uf</strong>.</p>
              </div>

              {importing && (
                <div className="flex items-center gap-2 text-xs text-brand-600 font-semibold">
                  <Loader2 size={16} className="animate-spin" /> Importando e cadastrando demandas...
                </div>
              )}
              {importResult && (
                <div className={`flex items-center gap-2 text-xs font-bold rounded-xl p-3 ${importResult.fail === 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                  {importResult.fail === 0 ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  {importResult.ok} importada(s) com sucesso{importResult.fail > 0 ? ` • ${importResult.fail} ignorada(s)` : ''}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

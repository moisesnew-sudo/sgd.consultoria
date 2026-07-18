import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { UploadCloud, Download, FileSpreadsheet, FileText, FileJson, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Demand } from '../types';
import { demandsApi, formatDate } from '../services/api';

interface ImportExportBarProps {
  rows: Demand[];
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
  mapped.category = mapped.category || mapped.title.substring(0, 30);
  mapped.status = mapped.status || 'pendente';
  mapped.priority = mapped.priority || 'media';
  return mapped as Partial<Demand>;
}

export default function ImportExportBar({ rows, onImported }: ImportExportBarProps) {
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
      const isCsv = file.name.toLowerCase().endsWith('.csv');
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
      alert('Erro ao ler arquivo: ' + (e.message || 'formato inválido'));
    } finally {
      setImporting(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (files && files.length) parseFile(files[0]);
  };

  const exportExcel = () => {
    const data = rows.map(d => ({
      ID: d.id,
      Título: d.title,
      Município: d.municipality,
      UF: d.uf,
      Status: d.status,
      Prioridade: d.priority,
      Categoria: d.category,
      Valor: d.requested_value,
      Órgão: d.organ || '',
      Proposta: d.proposal_number || '',
      Responsável: d.responsible_name || '',
      'Criado em': formatDate(d.created_at),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Demandas');
    XLSX.writeFile(wb, `sgd-demandas-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportCsv = () => {
    const headers = ['ID', 'Título', 'Município', 'UF', 'Status', 'Prioridade', 'Categoria', 'Valor', 'Órgão', 'Proposta', 'Responsável', 'Criado em'];
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map(d => [
      d.id, d.title, d.municipality, d.uf, d.status, d.priority, d.category,
      d.requested_value, d.organ || '', d.proposal_number || '', d.responsible_name || '', formatDate(d.created_at)
    ].map(escape).join(','));
    const csv = '﻿' + [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sgd-demandas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    const body = rows.map(d => `
      <tr>
        <td>${d.id}</td><td>${d.title}</td><td>${d.municipality}/${d.uf}</td>
        <td>${d.status}</td><td>${d.priority}</td><td>R$ ${(d.requested_value || 0).toFixed(2)}</td>
      </tr>`).join('');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>SGD - Relatório de Demandas</title>
      <style>
        body{font-family:Arial,sans-serif;margin:32px;color:#0f172a}
        h1{font-size:18px;margin:0 0 4px} p{color:#64748b;font-size:12px;margin:0 0 16px}
        table{width:100%;border-collapse:collapse;font-size:11px}
        th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left}
        th{background:#001f4d;color:#fff}
        tr:nth-child(even){background:#f8fafc}
      </style></head><body>
      <h1>SGD — Relatório de Demandas</h1>
      <p>Gerado em ${new Date().toLocaleString('pt-BR')} • ${rows.length} registro(s) filtrado(s)</p>
      <table><thead><tr>
        <th>ID</th><th>Título</th><th>Município/UF</th><th>Status</th><th>Prioridade</th><th>Valor</th>
      </tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=()=>{window.print()}</script>
      </body></html>`);
    win.document.close();
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

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import { UploadCloud, Download, FileText, FileSpreadsheet, FileDown, Printer, Sparkles, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Demand } from '../../types';
import { demandsApi, formatDateShort, logExport } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import ExportMenu, { ExportMenuItem } from '../ui/ExportMenu';
import { Modal } from '../ui/Modal';
import { LOGO_B64, LOGO_DATA_URL } from '../reports/logoBase64';
import { SL, PL } from '../reports/report-utils';

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

  /* ---------- Exportações formatadas (Excel institucional + CSV limpo) ---------- */

  const up = (v: any) => String(v ?? '').toUpperCase();
  const fmtNumBr = (n: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const fmtCurrency = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n || 0);

  const EXPORT_COLUMNS: { key: string; header: string; text?: boolean }[] = [
    { key: 'id', header: 'ID' },
    { key: 'title', header: 'Título', text: true },
    { key: 'municipality', header: 'Município', text: true },
    { key: 'uf', header: 'UF' },
    { key: 'ano', header: 'Ano' },
    { key: 'status', header: 'Status' },
    { key: 'priority', header: 'Prioridade' },
    { key: 'category', header: 'Categoria', text: true },
    { key: 'requested_value', header: 'Valor Global' },
    { key: 'organ', header: 'Órgão', text: true },
    { key: 'proposal_number', header: 'Proposta', text: true },
    { key: 'responsible_name', header: 'Responsável', text: true },
    { key: 'created_at', header: 'Criado em' },
  ];

  const rowValue = (d: Demand, col: { key: string }): string | number => {
    switch (col.key) {
      case 'title':
      case 'municipality':
      case 'category':
      case 'organ':
      case 'proposal_number':
      case 'responsible_name':
        return up(d[col.key as keyof Demand]);
      case 'uf':
        return d.uf || '';
      case 'ano':
        return d.ano ?? '';
      case 'status':
        return up(SL[d.status] || d.status);
      case 'priority':
        return up(PL[d.priority] || d.priority);
      case 'requested_value':
        return d.requested_value || 0;
      case 'created_at':
        return d.created_at;
      default:
        return d.id;
    }
  };

  const describeFilters = (f: FiltersState | undefined): string => {
    if (!f) return '';
    const parts: string[] = [];
    if (f.search) parts.push(`Busca: ${f.search}`);
    if (f.status) parts.push(`Status: ${SL[f.status] || f.status}`);
    if (f.priority) parts.push(`Prioridade: ${PL[f.priority] || f.priority}`);
    if (f.category) parts.push(`Categoria: ${f.category}`);
    if (f.uf) parts.push(`UF: ${f.uf}`);
    if (f.responsible) parts.push(`Responsável: ${f.responsible}`);
    if (f.ano) parts.push(`Ano: ${f.ano}`);
    if (f.dateFrom) parts.push(`De: ${formatDateShort(f.dateFrom)}`);
    if (f.dateTo) parts.push(`Até: ${formatDateShort(f.dateTo)}`);
    if (f.valueMin) parts.push(`Valor mín.: ${fmtNumBr(Number(f.valueMin))}`);
    if (f.valueMax) parts.push(`Valor máx.: ${fmtNumBr(Number(f.valueMax))}`);
    return parts.length ? parts.join('; ') : 'Sem filtros';
  };

  const getImageSize = (dataUrl: string): Promise<{ w: number; h: number }> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 100, h: 60 });
      img.src = dataUrl;
    });

  const exportExcel = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SGD — Sistema de Gestão de Demandas';
    const ws = wb.addWorksheet('Demandas');

    const GOV = 'FF0F5132';
    const MUTED = 'FF64748B';
    const INK = 'FF1E293B';
    const BORDER = 'FFD0D9D3';
    const ZEBRA = 'FFF4F9F6';
    const STATUS_FILL: Record<string, string> = { pendente: 'FFFFF7E0', analise: 'FFE8F1FD', concluido: 'FFE1F5EC', rejeitado: 'FFFBE9EB' };
    const STATUS_FONT: Record<string, string> = { pendente: 'FF9A6700', analise: 'FF084298', concluido: 'FF0E6841', rejeitado: 'FFA32134' };

    const now = new Date();
    const n = rows.length;

    /* Logo (proporção preservada) */
    const size = await getImageSize(LOGO_DATA_URL);
    const logoW = 96;
    const logoH = Math.round((logoW * size.h) / size.w);
    const imageId = wb.addImage({ base64: LOGO_B64, extension: 'jpeg' });
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: logoW, height: logoH } });

    /* Cabeçalho institucional */
    ws.mergeCells('B1:F1');
    const titleCell = ws.getCell('B1');
    titleCell.value = 'SISTEMA DE GESTÃO DE DEMANDAS';
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: GOV } };
    ws.getRow(1).height = 24;

    ws.mergeCells('B2:F2');
    const subCell = ws.getCell('B2');
    subCell.value = 'CGASI.SE — Coordenação Geral de Articulação e Supervisão Institucional';
    subCell.font = { name: 'Calibri', size: 10, color: { argb: MUTED } };
    ws.getRow(2).height = 16;

    ws.mergeCells('B3:F3');
    const orgCell = ws.getCell('B3');
    orgCell.value = 'Ministério da Agricultura e Pecuária';
    orgCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: GOV } };
    ws.getRow(3).height = 16;

    ws.getRow(4).height = 8;

    const dateStr = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now);
    ws.getCell('B5').value = `Gerado em: ${dateStr}`;
    ws.getCell('B5').font = { name: 'Calibri', size: 9, bold: true, color: { argb: INK } };
    ws.getCell('D5').value = `Usuário: ${user?.name || '—'}`;
    ws.getCell('D5').font = { name: 'Calibri', size: 9, color: { argb: INK } };
    ws.getCell('F5').value = `Registros: ${n}`;
    ws.getCell('F5').font = { name: 'Calibri', size: 9, bold: true, color: { argb: GOV } };
    ws.getRow(5).height = 16;

    ws.mergeCells('B6:F6');
    const filtCell = ws.getCell('B6');
    filtCell.value = `Filtros aplicados: ${describeFilters(filters)}`;
    filtCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: MUTED } };
    ws.getRow(6).height = 16;

    /* Larguras (autoajuste por conteúdo) */
    const widths = EXPORT_COLUMNS.map((col) => {
      let max = col.header.length;
      for (const d of rows) {
        const v = String(rowValue(d, col));
        if (v.length > max) max = v.length;
      }
      return Math.min(60, Math.max(10, Math.round(max * 1.05 + 2)));
    });
    ws.columns = EXPORT_COLUMNS.map((_, i) => ({ width: widths[i] }));

    /* Cabeçalho da tabela */
    const HEADER_ROW = 7;
    const thinBorder = { style: 'thin' as const, color: { argb: BORDER } };
    const headerCellStyle = {
      font: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: GOV } },
      border: { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder },
      alignment: { vertical: 'middle' as const, horizontal: 'center' as const, wrapText: true },
    };
    EXPORT_COLUMNS.forEach((col, i) => {
      const cell = ws.getCell(HEADER_ROW, i + 1);
      cell.value = col.header.toUpperCase();
      Object.assign(cell, headerCellStyle);
    });
    ws.getRow(HEADER_ROW).height = 24;

    /* Linhas de dados */
    rows.forEach((d, idx) => {
      const rowNum = HEADER_ROW + 1 + idx;
      const row = ws.getRow(rowNum);
      const zebra = idx % 2 === 1;
      const estLines = (v: string, w: number) => Math.max(1, Math.ceil(v.length / Math.max(1, w - 4)));

      EXPORT_COLUMNS.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        const w = widths[i];
        const border = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

        if (col.key === 'created_at') {
          const parsed = new Date(d.created_at);
          cell.value = isNaN(parsed.getTime()) ? d.created_at : parsed;
          cell.numFmt = 'dd/mm/yyyy';
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (col.key === 'requested_value') {
          cell.value = d.requested_value || 0;
          cell.numFmt = '"R$" #,##0.00';
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        } else if (col.key === 'ano') {
          cell.value = d.ano ?? '';
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (col.key === 'id' || col.key === 'uf') {
          cell.value = String(rowValue(d, col));
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        } else if (col.key === 'status') {
          cell.value = String(rowValue(d, col));
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          if (STATUS_FILL[d.status]) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[d.status] } };
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: STATUS_FONT[d.status] } };
          }
        } else {
          const v = String(rowValue(d, col));
          cell.value = v;
          cell.alignment = { vertical: 'middle', horizontal: col.text ? 'left' : 'center', wrapText: true };
          if (col.text) {
            row.height = Math.max(row.height || 20, Math.min(68, estLines(v, w) * 13 + 6));
          }
        }
        cell.font = cell.font || { name: 'Calibri', size: 10, color: { argb: INK } };
        cell.border = border;
        if (zebra && !cell.fill) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
        }
      });
    });

    /* Rodapé */
    const footRow = HEADER_ROW + n + 2;
    ws.getCell(`A${footRow}`).value = `Total de registros: ${n}`;
    ws.getCell(`A${footRow}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: GOV } };
    ws.mergeCells(`B${footRow}:E${footRow}`);
    ws.getCell(`B${footRow}`).value = `Soma do Valor Global: ${fmtCurrency(rows.reduce((s, d) => s + (d.requested_value || 0), 0))}`;
    ws.getCell(`B${footRow}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK } };
    ws.mergeCells(`F${footRow}:H${footRow}`);
    ws.getCell(`F${footRow}`).value = `Data de emissão: ${dateStr}`;
    ws.getCell(`F${footRow}`).font = { name: 'Calibri', size: 10, color: { argb: MUTED } };
    ws.mergeCells(`I${footRow}:M${footRow}`);
    ws.getCell(`I${footRow}`).value = 'www.gruposgd.com.br';
    ws.getCell(`I${footRow}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: GOV } };
    ws.getCell(`I${footRow}`).alignment = { horizontal: 'right' };
    ws.getRow(footRow).height = 20;

    /* Congelar cabeçalho + autofiltro */
    ws.views = [{ state: 'frozen', ySplit: HEADER_ROW + 1 }];
    if (n > 0) {
      ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW + n, column: EXPORT_COLUMNS.length } };
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sgd-demandas-${now.toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    logExport('excel', rows.length, filters, rows.map(r => r.id));
  };

  const exportCsv = () => {
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map(d => EXPORT_COLUMNS.map(col => {
      if (col.key === 'created_at') return escape(formatDateShort(d.created_at));
      if (col.key === 'requested_value') return escape(fmtNumBr(d.requested_value || 0));
      return escape(rowValue(d, col));
    }).join(';'));
    const csv = '\uFEFF' + [EXPORT_COLUMNS.map(c => c.header).join(';'), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sgd-demandas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logExport('csv', rows.length, filters, rows.map(r => r.id));
  };

  const exportPdf = async () => {
    const { buildPdfReport } = await import('../reports/pdfAutoReport');
    await buildPdfReport({
      demands: rows,
      filters: filters as FiltersState,
      userLabel: user?.name || '—',
      mode: 'compact',
      fileName: `sgd-demandas-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
    logExport('pdf', rows.length, filters, rows.map(r => r.id));
  };

  const exportFullReport = async () => {
    const { buildPdfReport } = await import('../reports/pdfAutoReport');
    await buildPdfReport({
      demands: rows,
      filters: filters as FiltersState,
      userLabel: user?.name || '—',
      mode: 'full',
      open: true,
      title: 'RELATÓRIO EXECUTIVO DE DEMANDAS',
      fileName: `sgd-relatorio-executivo-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
    logExport('pdf', rows.length, filters, rows.map(r => r.id));
  };

  const printPdf = async () => {
    const w = window.open('', '_blank');
    if (!w) {
      throw new Error('Impressão bloqueada pelo navegador. Permita pop-ups ou use a opção PDF.');
    }
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>Imprimir — SGD</title>' +
      '<style>body{margin:0;background:#f1f5f9}#pdf{display:block;width:100vw;height:100vh;border:0}</style>' +
      '</head><body><iframe id="pdf"></iframe></body></html>'
    );
    w.document.close();
    try {
      const { buildPdfReport } = await import('../reports/pdfAutoReport');
      const doc = await buildPdfReport({
        demands: rows,
        filters: filters as FiltersState,
        userLabel: user?.name || '—',
        mode: 'compact',
        fileName: `sgd-demandas-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      const url = doc.output('bloburl');
      const frame = w.document.getElementById('pdf') as HTMLIFrameElement | null;
      if (frame) {
        frame.onload = () => {
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          } catch {
            /* viewer nativo permanece para impressão manual */
          }
        };
        frame.src = url;
      }
    } catch (e: any) {
      w.close();
      throw new Error(e?.message || 'Não foi possível gerar o relatório para impressão.');
    }
  };

  const exportItems: ExportMenuItem[] = [
    ...(canExportExcel ? [{
      id: 'excel',
      label: 'Exportar para Excel',
      description: 'Relatório institucional formatado .xlsx',
      icon: <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400" />,
      onSelect: exportExcel,
    }] : []),
    ...(canExportExcel ? [{
      id: 'csv',
      label: 'Exportar CSV',
      description: 'Dados limpos .csv (intercâmbio)',
      icon: <FileDown size={16} className="text-slate-500 dark:text-slate-400" />,
      onSelect: exportCsv,
    }] : []),
    ...(canExportPdf ? [{
      id: 'pdf',
      label: 'Exportar para PDF',
      description: 'Relatório compacto em .pdf',
      icon: <FileText size={16} className="text-red-600 dark:text-red-400" />,
      onSelect: exportPdf,
    }] : []),
    ...(canExportPdf ? [{
      id: 'report',
      label: 'Relatório',
      description: 'Relatório executivo completo em .pdf',
      icon: <Sparkles size={16} className="text-purple-600 dark:text-purple-400" />,
      onSelect: exportFullReport,
    }] : []),
    ...(canExportPdf ? [{
      id: 'print',
      label: 'Imprimir',
      description: 'Abre o diálogo de impressão do navegador',
      icon: <Printer size={16} className="text-blue-600 dark:text-blue-400" />,
      onSelect: printPdf,
    }] : []),
  ];

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <UploadCloud size={15} /> Importar
        </button>
        <ExportMenu
          items={exportItems}
          buttonLabel="Exportar"
          buttonIcon={<Download size={15} />}
          menuTitle="Exportar demandas"
          buttonClassName="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors"
        />
      </div>

      {isOpen && (
        <Modal
          open
          title={
            <span className="flex items-center gap-2">
              <UploadCloud size={18} className="text-brand-600" /> Importar Demandas
            </span>
          }
          size="lg"
          onClose={() => setIsOpen(false)}
          className="max-w-lg"
        >
          <div className="space-y-4">
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
        </Modal>
      )}
    </>
  );
}

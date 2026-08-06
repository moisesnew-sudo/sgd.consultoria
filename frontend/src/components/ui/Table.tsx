import React from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

export function Table({ children, className = '', minWidth = 640 }: { children: React.ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm text-left ${className}`} style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-[10px] uppercase font-extrabold text-slate-500 dark:text-slate-400 tracking-wider">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ children, className = '', align = 'left', ...rest }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center' } & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th {...rest} scope="col" className={`px-5 py-3.5 whitespace-nowrap ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}>
      {children}
    </th>
  );
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">{children}</tbody>;
}

export function Tr({ children, className = '', ...rest }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...rest} className={`hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors ${className}`}>{children}</tr>;
}

export function Td({ children, className = '', align = 'left', ...rest }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center' } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...rest} className={`px-5 py-3 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}>
      {children}
    </td>
  );
}

export function TableEmpty({ colSpan, message = 'Nenhum registro encontrado.' }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center">
        <Inbox size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
        <p className="text-sm text-slate-400 italic">{message}</p>
      </td>
    </tr>
  );
}

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
  label?: string;
}

export function Pagination({ page, pages, total, onChange, label }: PaginationProps) {
  const shown = label || `Página ${page} de ${Math.max(pages, 1)} · ${total} registros`;
  return (
    <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between gap-3 flex-wrap">
      <p className="text-[10px] font-mono text-slate-400">{shown}</p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Página anterior"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => onChange(Math.min(pages, page + 1))}
          disabled={page >= pages}
          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Próxima página"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

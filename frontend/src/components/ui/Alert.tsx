import React from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertOctagon, X } from 'lucide-react';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const VARIANT_META: Record<AlertVariant, { icon: React.ReactNode; cls: string; titleCls: string }> = {
  info: {
    icon: <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />,
    cls: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/50',
    titleCls: 'text-blue-800 dark:text-blue-200',
  },
  success: {
    icon: <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />,
    cls: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50',
    titleCls: 'text-emerald-800 dark:text-emerald-200',
  },
  warning: {
    icon: <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />,
    cls: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50',
    titleCls: 'text-amber-800 dark:text-amber-200',
  },
  danger: {
    icon: <AlertOctagon size={16} className="text-red-500 shrink-0 mt-0.5" />,
    cls: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50',
    titleCls: 'text-red-800 dark:text-red-200',
  },
};

interface AlertProps {
  variant?: AlertVariant;
  title?: React.ReactNode;
  children?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export function Alert({ variant = 'info', title, children, onClose, className = '' }: AlertProps) {
  const meta = VARIANT_META[variant];
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3.5 text-xs animate-fade-in ${meta.cls} ${className}`} role="alert">
      {meta.icon}
      <div className="min-w-0 flex-1">
        {title && <p className={`font-bold text-xs ${meta.titleCls}`}>{title}</p>}
        {children && <div className="text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{children}</div>}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
          aria-label="Fechar alerta"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

import React from 'react';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg';

const SIZE_CLS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
};

interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  size?: ModalSize;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  hideClose?: boolean;
  className?: string;
}

export function Modal({
  open,
  title,
  subtitle,
  icon,
  size = 'md',
  onClose,
  children,
  footer,
  hideClose = false,
  className = '',
}: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className={`bg-white dark:bg-[#111a2e] rounded-2xl shadow-2xl w-full animate-scale-in flex flex-col max-h-[90vh] ${SIZE_CLS[size]} ${className}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-700/50 shrink-0">
            <div className="flex items-start gap-3 min-w-0">
              {icon && (
                <span className="w-9 h-9 shrink-0 rounded-xl bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300 flex items-center justify-center">
                  {icon}
                </span>
              )}
              <div className="min-w-0">
                {title && <h3 className="text-base font-black text-slate-800 dark:text-white leading-tight">{title}</h3>}
                {subtitle && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
              </div>
            </div>
            {onClose && !hideClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

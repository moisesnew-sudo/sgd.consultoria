import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type DrawerSize = 'sm' | 'md' | 'lg';

const SIZE_CLS: Record<DrawerSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let drawerIdCounter = 0;

interface DrawerProps {
  open: boolean;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  size?: DrawerSize;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  hideClose?: boolean;
  className?: string;
}

export function Drawer({
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
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleIdRef = useRef<string | null>(null);
  if (titleIdRef.current === null) titleIdRef.current = `sgd-drawer-title-${++drawerIdCounter}`;
  const titleId = titleIdRef.current;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusInitial = () => {
      const els = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const target = els[0] || panel;
      target.focus();
    };
    const restoreFocus = () => {
      previouslyFocused?.focus?.();
    };

    const raf = requestAnimationFrame(focusInitial);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const hasFocus = panel.contains(active);
      if (e.shiftKey && (active === first || !hasFocus)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !hasFocus)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      restoreFocus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        className={`absolute right-0 top-0 h-full w-full bg-white dark:bg-[#111a2e] shadow-2xl animate-drawer flex flex-col ${SIZE_CLS[size]} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700/50 shrink-0">
            <div className="flex items-start gap-3 min-w-0">
              {icon && (
                <span className="w-9 h-9 shrink-0 rounded-xl bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300 flex items-center justify-center">
                  {icon}
                </span>
              )}
              <div className="min-w-0">
                {title && <h3 id={titleId} className="text-sm font-black text-slate-800 dark:text-white leading-tight">{title}</h3>}
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
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  titleCls?: string;
}

export function Card({ children, className = '', title, subtitle, icon, action, titleCls = '' }: CardProps) {
  return (
    <div className={`bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700/50">
          <div className="flex items-start gap-3 min-w-0">
            {icon && (
              <div className="shrink-0 w-9 h-9 rounded-xl bg-gov-50 dark:bg-gov-900/40 text-gov-700 dark:text-gov-300 flex items-center justify-center">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && <h3 className={`text-sm font-bold text-slate-800 dark:text-slate-100 truncate ${titleCls}`}>{title}</h3>}
              {subtitle && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      <div className={title || action ? 'p-5' : 'p-0'}>{children}</div>
    </div>
  );
}

export { Kpi } from './Kpi';
export type { KpiProps } from './Kpi';

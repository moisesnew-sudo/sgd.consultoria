import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function Card({ children, className = '', title, subtitle, icon, action }: CardProps) {
  return (
    <div className={`bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl shadow-sm hover:shadow-md transition-shadow ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700/50">
          <div className="flex items-start gap-3 min-w-0">
            {icon && (
              <div className="shrink-0 w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 flex items-center justify-center">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{title}</h3>}
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

interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  accent?: 'brand' | 'green' | 'amber' | 'rose' | 'blue';
  trend?: { value: string; positive?: boolean };
}

const accentMap: Record<NonNullable<KpiProps['accent']>, string> = {
  brand: 'bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300',
  green: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300',
  amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300',
  rose: 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300',
  blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300',
};

export function Kpi({ label, value, hint, icon, accent = 'brand', trend }: KpiProps) {
  return (
    <div className="group bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${accentMap[accent]}`}>
          {icon}
        </div>
        {trend && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${trend.positive ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300'}`}>
            {trend.value}
          </span>
        )}
      </div>
      <div className="mt-4">
        <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider leading-tight">{label}</h3>
        <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tracking-tight">{value}</p>
        {hint && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">{hint}</p>}
      </div>
    </div>
  );
}

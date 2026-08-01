import React from 'react';

export interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  accent?: 'gov' | 'green' | 'amber' | 'rose' | 'blue' | 'brand';
  trend?: { value: string; positive?: boolean };
  highlight?: 'brand' | 'rose';
}

const accentMap: Record<NonNullable<KpiProps['accent']>, string> = {
  gov: 'bg-gov-50 dark:bg-gov-900/40 text-gov-700 dark:text-gov-300',
  brand: 'bg-gov-50 dark:bg-gov-900/40 text-gov-700 dark:text-gov-300',
  green: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300',
  amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300',
  rose: 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300',
  blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300',
};

const highlightMap: Record<NonNullable<KpiProps['highlight']>, string> = {
  brand: 'bg-gov-50/60 dark:bg-gov-900/20 border-gov-200 dark:border-gov-700/50',
  rose: 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/40',
};

export function Kpi({ label, value, hint, icon, accent = 'brand', trend, highlight }: KpiProps) {
  return (
    <div className={`group rounded-2xl p-5 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 duration-200 ${highlight ? highlightMap[highlight] : 'bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50'}`}>
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
        <h3 className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider leading-tight">{label}</h3>
        <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tracking-tight">{value}</p>
        {hint && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">{hint}</p>}
      </div>
    </div>
  );
}

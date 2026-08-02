import React from 'react';

interface SummaryCardProps {
  icon: React.ReactNode;
  iconBgCls?: string;
  label: string;
  value: React.ReactNode;
  valueCls?: string;
}

export function SummaryCard({ icon, iconBgCls = 'bg-brand-50 dark:bg-brand-950/30', label, value, valueCls = 'text-lg font-black text-slate-800 dark:text-white leading-tight' }: SummaryCardProps) {
  return (
    <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-3.5 shadow-sm flex items-center gap-3">
      <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${iconBgCls}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`${valueCls} truncate`}>{value}</p>
      </div>
    </div>
  );
}

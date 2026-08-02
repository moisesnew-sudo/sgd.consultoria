import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, icon, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${className}`}>
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 self-start lg:self-center flex-wrap">{actions}</div>}
    </div>
  );
}

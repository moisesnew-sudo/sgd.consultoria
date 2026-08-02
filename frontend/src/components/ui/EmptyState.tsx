import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, subtitle, className = '' }: EmptyStateProps) {
  return (
    <div className={`py-10 text-center ${className}`}>
      {icon && <div className="mx-auto w-fit text-slate-300 dark:text-slate-600 mb-2">{icon}</div>}
      {title && <p className="text-sm text-slate-400 italic">{title}</p>}
      {subtitle && <p className="text-xs text-slate-400/70 mt-1">{subtitle}</p>}
    </div>
  );
}

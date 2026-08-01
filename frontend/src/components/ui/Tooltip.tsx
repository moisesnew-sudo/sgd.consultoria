import React from 'react';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

const POSITION_CLS: Record<TooltipPosition, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

interface TooltipProps {
  label: React.ReactNode;
  children: React.ReactNode;
  position?: TooltipPosition;
  className?: string;
}

export function Tooltip({ label, children, position = 'top', className = '' }: TooltipProps) {
  return (
    <span className={`relative inline-flex group ${className}`}>
      {children}
      <span
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-bold px-2.5 py-1.5 shadow-lg opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 ${POSITION_CLS[position]}`}
      >
        {label}
      </span>
    </span>
  );
}

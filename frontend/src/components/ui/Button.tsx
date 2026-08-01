import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 hover:bg-brand-800 text-white shadow-sm',
  secondary: 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 shadow-sm',
  outline: 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800',
  ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
  danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
  subtle: 'bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/40',
};

const SIZE_CLS: Record<ButtonSize, string> = {
  sm: 'h-[34px] px-2.5 text-[11px] gap-1.5 rounded-lg',
  md: 'h-[40px] px-3.5 text-xs gap-2 rounded-xl',
  lg: 'h-[46px] px-5 text-sm gap-2 rounded-xl',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  fullWidth = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none ${VARIANT_CLS[variant]} ${SIZE_CLS[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="animate-spin" /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

import React from 'react';

const FIELD_BASE =
  'w-full h-[40px] px-3.5 rounded-xl border text-sm bg-white dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent';

const FIELD_ERROR = 'border-red-400 dark:border-red-700/70 focus:ring-red-500';

interface FieldWrapProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  id?: string;
  children: React.ReactNode;
}

function FieldWrap({ label, error, hint, required, id, children }: FieldWrapProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[11px] font-semibold text-red-500">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  onClear?: () => void;
}

export function Input({ label, error, hint, icon, iconRight, className = '', id, required, ...rest }: InputProps) {
  return (
    <FieldWrap label={label} error={error} hint={hint} required={required} id={id}>
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center">
            {icon}
          </span>
        )}
        <input
          id={id}
          required={required}
          lang="pt-BR"
          spellCheck={true}
          {...rest}
          className={`${FIELD_BASE} ${icon ? 'pl-10' : ''} ${iconRight || rest.onClear ? 'pr-10' : ''} ${error ? FIELD_ERROR : 'border-slate-200 dark:border-slate-700'} ${className}`}
        />
        {(iconRight || rest.onClear) && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center text-slate-400">
            {iconRight}
          </span>
        )}
      </div>
    </FieldWrap>
  );
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Select({ label, error, hint, className = '', id, required, children, ...rest }: SelectProps) {
  return (
    <FieldWrap label={label} error={error} hint={hint} required={required} id={id}>
      <select
        id={id}
        required={required}
        {...rest}
        className={`${FIELD_BASE} cursor-pointer ${error ? FIELD_ERROR : 'border-slate-200 dark:border-slate-700'} ${className}`}
      >
        {children}
      </select>
    </FieldWrap>
  );
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Textarea({ label, error, hint, className = '', id, required, ...rest }: TextareaProps) {
  return (
    <FieldWrap label={label} error={error} hint={hint} required={required} id={id}>
      <textarea
        id={id}
        required={required}
        lang="pt-BR"
        spellCheck={true}
        {...rest}
        className={`w-full min-h-[96px] px-3.5 py-2.5 rounded-xl border text-sm bg-white dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent ${
          error ? FIELD_ERROR : 'border-slate-200 dark:border-slate-700'
        } ${className}`}
      />
    </FieldWrap>
  );
}

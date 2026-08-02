import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { SearchSuggestion } from '../../lib/search';

interface SmartSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  suggestions: SearchSuggestion[];
  placeholder?: string;
  resultCount?: number;
  className?: string;
}

export function SmartSearchInput({
  value,
  onChange,
  onCommit,
  suggestions,
  placeholder = 'Pesquisar...',
  resultCount,
  className = '',
}: SmartSearchInputProps) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    setHi(0);
  }, [suggestions]);

  const pick = (s: SearchSuggestion) => {
    onChange(s.insert);
    setOpen(s.insert.trim().endsWith(':'));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') onCommit?.(value);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi(h => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(h => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = suggestions[hi];
      if (s) pick(s);
      else onCommit?.(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  let lastGroup: string | null = null;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Pesquisar demandas"
        className="w-full pl-10 pr-8 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Limpar pesquisa"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X size={14} />
        </button>
      )}

      {open && suggestions.length > 0 && (
        <div className="absolute z-30 mt-2 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden animate-scale-in">
          <div className="max-h-80 overflow-y-auto custom-scrollbar py-1.5">
            {suggestions.map((s, i) => {
              const showHeader = s.group !== lastGroup;
              lastGroup = s.group;
              return (
                <div key={s.id}>
                  {showHeader && (
                    <p className="px-3.5 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {s.groupLabel}
                    </p>
                  )}
                  <button
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(s)}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors ${
                      hi === i ? 'bg-brand-50 dark:bg-brand-900/20' : ''
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.dotCls}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{s.label}</span>
                      {s.sub && <span className="block text-[10px] text-slate-400 truncate">{s.sub}</span>}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          {resultCount !== undefined && (
            <div className="px-3.5 py-2 border-t border-slate-100 dark:border-slate-800 text-[10px] font-semibold text-slate-400 bg-slate-50 dark:bg-slate-800/40">
              {resultCount} {resultCount === 1 ? 'resultado' : 'resultados'} em tempo real
            </div>
          )}
        </div>
      )}
    </div>
  );
}

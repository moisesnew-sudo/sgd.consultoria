import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, ChevronDown, AlertCircle, Plus, Check } from 'lucide-react';
import { textKey } from '../../lib/string';

export interface SearchSelectOption {
  value: string;
  label?: string;
  secondary?: string;
  meta?: any;
}

interface SearchSelectProps {
  label?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  onSelect?: (option: SearchSelectOption | null) => void;
  /** Lista local (óráos, usuários) — filtrada no cliente. */
  options?: SearchSelectOption[];
  /** Busca remota (municípios, objetos) — com debounce. */
  fetcher?: (query: string) => Promise<SearchSelectOption[]>;
  /** Exige que o valor seja exatamente uma opção (bloqueia digitação livre). */
  strict?: boolean;
  /** Mantém texto livre como valor (objeto). */
  allowFreeText?: boolean;
  /** Permite criar nova opção quando não encontrada (apenas para quem tem permissão). */
  allowCreate?: boolean;
  onCreate?: (label: string) => Promise<SearchSelectOption | void>;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  loading?: boolean;
  noMatchMessage?: string;
  autoComplete?: string;
  spellCheck?: boolean;
  className?: string;
}

const BASE =
  'w-full h-[40px] px-3.5 rounded-xl border text-sm bg-white dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent pr-9';

function highlightOptionText(text: string, query: string): React.ReactNode {
  const q = textKey(query);
  if (!q) return text;
  const idx = textKey(text).indexOf(q);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-brand-100 dark:bg-brand-900/60 text-brand-800 dark:text-brand-200 rounded-sm">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function SearchSelect({
  label,
  required,
  value,
  onChange,
  onSelect,
  options,
  fetcher,
  strict,
  allowFreeText,
  allowCreate,
  onCreate,
  placeholder,
  error,
  hint,
  disabled,
  loading,
  noMatchMessage,
  autoComplete = 'off',
  spellCheck = false,
  className = '',
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [fetched, setFetched] = useState<SearchSelectOption[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [strictError, setStrictError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filtro local (sem acento/caixa, parcial).
  const localMatches = useMemo(() => {
    if (!options) return [];
    const q = textKey(value);
    if (!q) return options;
    return options.filter(o => textKey(o.value).includes(q));
  }, [options, value]);

  const matches = fetcher ? fetched : localMatches;

  // Busca remota com debounce.
  useEffect(() => {
    if (!fetcher) return;
    const q = value.trim();
    if (!q) {
      setFetched([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetcher(q);
        setFetched(res);
        setHighlight(0);
      } catch {
        setFetched([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [fetcher, value]);

  // Fecha ao clicar fora.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const clearAux = () => {
    setSuggestion(null);
    setStrictError(null);
  };

  const selectOption = (opt: SearchSelectOption) => {
    onChange(opt.value);
    onSelect?.(opt);
    clearAux();
    setOpen(false);
  };

  const handleChange = (text: string) => {
    onChange(text);
    clearAux();
    setOpen(true);
    setHighlight(0);
  };

  const runStrictValidation = () => {
    const q = value.trim();
    if (!q) {
      setSuggestion(null);
      setStrictError(null);
      return;
    }
    if (matches.length === 0) {
      setSuggestion(null);
      setStrictError(null);
      return;
    }
    const key = textKey(q);
    const exact = matches.find(o => textKey(o.value) === key);
    if (exact) {
      setStrictError(null);
      setSuggestion(exact.value !== q ? exact.value : null);
    } else if (allowFreeText) {
      setSuggestion(null);
      setStrictError(null);
    } else {
      setSuggestion(null);
      setStrictError(noMatchMessage || 'Selecione um item válido da lista.');
    }
  };

  const handleBlur = () => {
    blurTimer.current = setTimeout(() => {
      setOpen(false);
      if (strict) runStrictValidation();
      else clearAux();
    }, 150);
  };

  const handleFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    clearAux();
    setOpen(true);
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    const opt = matches.find(o => textKey(o.value) === textKey(suggestion)) || { value: suggestion };
    selectOption(opt);
  };

  const handleCreate = async () => {
    if (!onCreate || !value.trim()) return;
    setCreating(true);
    try {
      const created = await onCreate(value.trim().toUpperCase());
      const opt: SearchSelectOption = created && 'value' in created ? created : { value: value.trim().toUpperCase() };
      selectOption(opt);
    } catch {
      /* erro tratado pelo chamador */
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[highlight]) {
        selectOption(matches[highlight]);
      } else if (allowFreeText) {
        onChange(value.trim());
        clearAux();
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const canCreate = allowCreate && value.trim() && !matches.some(o => textKey(o.value) === textKey(value));

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div ref={containerRef} className="relative">
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={spellCheck}
          autoComplete={autoComplete}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={onKeyDown}
          className={`${BASE} ${error || strictError ? 'border-red-400 dark:border-red-700/70 focus:ring-red-500' : 'border-slate-200 dark:border-slate-700'} ${className}`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center">
          {loading || creating ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}
        </span>

        {open && !disabled && matches.length > 0 && (
          <div className="absolute z-40 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111a2e] shadow-lg custom-scrollbar">
            {matches.map((opt, i) => {
              const selected = textKey(opt.value) === textKey(value);
              return (
                <button
                  key={`${opt.value}-${opt.secondary || ''}`}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); selectOption(opt); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                    i === highlight ? 'bg-brand-50 dark:bg-brand-900/40' : ''
                  } ${selected ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate">{highlightOptionText(opt.label || opt.value, value)}</span>
                    {opt.secondary && <span className="block text-[10px] text-slate-400 font-mono">{opt.secondary}</span>}
                  </span>
                  {selected && <Check size={14} className="shrink-0" />}
                </button>
              );
            })}
            {canCreate && (
              <div className="px-3.5 py-2 border-t border-slate-100 dark:border-slate-700/50">
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleCreate(); }}
                  className="w-full flex items-center gap-2 text-xs font-bold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/40 rounded-lg px-2 py-1.5 transition-colors"
                >
                  <Plus size={13} /> Criar &quot;{value.trim().toUpperCase()}&quot;
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {suggestion && !strictError && (
        <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 animate-fade-in">
          <AlertCircle size={11} className="shrink-0" />
          <span>Você quis dizer: <strong>{suggestion}</strong>?</span>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); applySuggestion(); }}
            className="ml-auto px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[9px] font-bold uppercase tracking-wider hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors cursor-pointer"
          >
            Usar
          </button>
        </p>
      )}

      {error ? (
        <p className="text-[11px] font-semibold text-red-500">{error}</p>
      ) : strictError ? (
        <p className="text-[11px] font-semibold text-red-500 flex items-center gap-1">
          <AlertCircle size={11} className="shrink-0" /> {strictError}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

export default SearchSelect;
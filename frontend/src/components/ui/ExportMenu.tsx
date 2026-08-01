import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';

export interface ExportMenuItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  onSelect: () => Promise<void> | void;
}

interface ExportMenuProps {
  items: ExportMenuItem[];
  buttonLabel?: string;
  buttonIcon?: React.ReactNode;
  buttonClassName?: string;
  align?: 'left' | 'right';
  menuTitle?: string;
}

function useIsDesktop(query = '(min-width: 640px)') {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export default function ExportMenu({
  items,
  buttonLabel = 'Exportar',
  buttonIcon,
  buttonClassName = 'flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors',
  align = 'right',
  menuTitle = 'Exportar',
}: ExportMenuProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [openSource, setOpenSource] = useState<'click' | 'hover' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const isDesktop = useIsDesktop();

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    setOpenSource(null);
    setActiveIndex(0);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const openMenu = useCallback((source: 'click' | 'hover') => {
    if (busyId) return;
    setOpenSource(source);
    setIsOpen(true);
  }, [busyId]);

  const handleToggle = () => {
    if (isOpen) {
      closeMenu(true);
    } else {
      openMenu('click');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isOpen, closeMenu]);

  const focusItem = (index: number) => {
    const el = itemRefs.current[index];
    el?.focus();
    setActiveIndex(index);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || items.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      focusItem((activeIndex + dir + items.length) % items.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(items.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  };

  const handleSelect = async (item: ExportMenuItem) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await item.onSelect();
      toast('success', 'Arquivo exportado com sucesso.');
      closeMenu(true);
    } catch (err: any) {
      toast('error', 'Erro ao exportar', err?.message || 'Não foi possível concluir. Tente novamente.');
      closeMenu(true);
    } finally {
      setBusyId(null);
    }
  };

  const renderItem = (item: ExportMenuItem, index: number) => {
    const isBusy = busyId === item.id;
    return (
      <button
        key={item.id}
        ref={(el) => { itemRefs.current[index] = el; }}
        type="button"
        role="menuitem"
        tabIndex={index === activeIndex ? 0 : -1}
        disabled={busyId !== null}
        onClick={() => handleSelect(item)}
        className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors flex items-start gap-3 group/item ${
          isBusy
            ? 'opacity-70 cursor-wait bg-slate-50 dark:bg-slate-800/60'
            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
        } disabled:cursor-not-allowed`}
      >
        <span className="w-8 h-8 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover/item:scale-105 transition-transform">
          {item.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">{item.label}</span>
          <span className="block text-[10px] text-slate-400 dark:text-slate-500 leading-tight mt-0.5">{item.description}</span>
        </span>
        {isBusy && <Loader2 size={14} className="animate-spin text-brand-600 shrink-0 mt-2" />}
      </button>
    );
  };

  const triggerContent = (
    <>
      {buttonIcon}
      <span>{buttonLabel}</span>
      <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
    </>
  );

  return (
    <>
      <div
        ref={containerRef}
        className="relative"
        onMouseEnter={() => { if (!isOpen) openMenu('hover'); }}
        onMouseLeave={() => { if (openSource === 'hover') closeMenu(false); }}
        onKeyDown={onMenuKeyDown}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={handleToggle}
          disabled={busyId !== null}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          className={buttonClassName}
        >
          {triggerContent}
        </button>

        {isOpen && isDesktop && items.length > 0 && (
          <div
            id={menuId}
            role="menu"
            aria-label={menuTitle}
            className={`absolute top-full mt-2 w-64 z-50 bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-1.5 space-y-0.5 animate-dropdown max-h-[70vh] overflow-y-auto ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {items.map(renderItem)}
          </div>
        )}
      </div>

      {isOpen && !isDesktop && items.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={menuTitle}
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs animate-fade-in"
            onClick={() => closeMenu(false)}
          />
          <div className="relative bg-white dark:bg-[#111a2e] rounded-t-3xl shadow-2xl border-t border-slate-100 dark:border-slate-700/50 animate-sheet-up pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3 className="text-sm font-black text-slate-800 dark:text-white">{menuTitle}</h3>
              <button
                type="button"
                onClick={() => closeMenu(false)}
                aria-label="Fechar"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-3 pb-4 space-y-1">
              {items.map((item, index) => (
                <div key={item.id} className="sm:hidden">
                  {renderItem(item, index)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

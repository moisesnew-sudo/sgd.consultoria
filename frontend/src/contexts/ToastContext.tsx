import React, { createContext, useContext, useState, useRef, useCallback, ReactNode } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextType {
  toasts: Toast[];
  toast: (type: ToastType, title: string, message?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const TOAST_DURATION = 4500;

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={18} />,
  error: <AlertCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

const STYLES: Record<ToastType, string> = {
  success: 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200',
  error: 'border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-800 text-red-800 dark:text-red-200',
  warning: 'border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 text-amber-800 dark:text-amber-200',
  info: 'border-blue-200 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-800 text-blue-800 dark:text-blue-200',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastsRef = useRef<Toast[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pausedRef = useRef(false);

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => {
      const next = prev.filter(t => t.id !== id);
      toastsRef.current = next;
      return next;
    });
  }, []);

  const scheduleRemoval = useCallback((id: string, delay: number = TOAST_DURATION) => {
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => removeToast(id), delay);
    timersRef.current.set(id, t);
  }, [removeToast]);

  const toast = useCallback((type: ToastType, title: string, message?: string) => {
    const current = toastsRef.current;
    const last = current[current.length - 1];
    if (last && last.type === type && last.title === title && last.message === message) {
      return;
    }
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next = [...current, { id, type, title, message }];
    toastsRef.current = next;
    setToasts(next);
    scheduleRemoval(id);
  }, [scheduleRemoval]);

  const handleMouseEnter = () => {
    pausedRef.current = true;
    timersRef.current.forEach(t => clearTimeout(t));
  };

  const handleMouseLeave = () => {
    pausedRef.current = false;
    toastsRef.current.forEach(t => scheduleRemoval(t.id));
  };

  React.useEffect(() => {
    return () => {
      timersRef.current.forEach(t => clearTimeout(t));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, removeToast }}>
      {children}
      <div
        className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-full sm:max-w-sm z-[100] flex flex-col gap-2 pointer-events-none"
        role="status"
        aria-live="polite"
        aria-atomic="false"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg animate-fade-in ${STYLES[t.type]}`}
            role={t.type === 'error' ? 'alert' : undefined}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.type]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{t.title}</p>
              {t.message && <p className="text-xs mt-0.5 opacity-80">{t.message}</p>}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
              aria-label="Fechar notificação"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}

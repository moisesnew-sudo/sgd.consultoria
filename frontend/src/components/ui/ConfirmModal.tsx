import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="bg-white dark:bg-[#111a2e] rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          {variant === 'danger' && (
            <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center text-red-600 shrink-0">
              <AlertTriangle size={20} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{message}</p>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-slate-900 hover:bg-brand-800 text-white'
            }`}
          >
            {loading ? 'Aguarde...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

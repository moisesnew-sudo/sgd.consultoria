import { CheckCircle2, AlertTriangle, AlertOctagon, Clock, Download, X, CheckCircle, AlertTriangle as AlertTriangleIcon, AlertOctagon as AlertOctagonIcon } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { formatDate } from '../../../services/api';
import type { IntegrationSyncResult } from '../../../types';

interface SyncResultModalProps {
  open: boolean;
  onClose: () => void;
  result: IntegrationSyncResult | null;
  systemName: string;
  loading?: boolean;
}

export default function SyncResultModal({ open, onClose, result, systemName, loading }: SyncResultModalProps) {
  if (!open || !result) return null;

  const isSuccess = result.status === 'success';
  const isWarning = result.status === 'warning';
  const isError = result.status === 'error';

  const statusConfig = {
    success: { label: 'Sucesso', icon: <CheckCircle2 size={24} className="text-emerald-500" />, cls: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50' },
    warning: { label: 'Aviso', icon: <AlertTriangleIcon size={24} className="text-amber-500" />, cls: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50' },
    error: { label: 'Erro', icon: <AlertOctagonIcon size={24} className="text-rose-500" />, cls: 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/50' },
  }[result.status];

  return (
    <Modal
      open={open}
      title="Resultado da Sincronização"
      subtitle={systemName}
      onClose={onClose}
      icon={statusConfig.icon}
      footer={
        <Button variant="primary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className={`p-4 rounded-xl border ${statusConfig.bg}`}>
        <div className="flex items-start gap-3">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${statusConfig.cls}`}>
            {statusConfig.icon}
            {statusConfig.label}
          </span>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block">Mensagem</label>
              <p className="text-slate-700 dark:text-slate-300">{result.message}</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block">Status HTTP</label>
              <p className="font-mono text-slate-700 dark:text-slate-300">{result.httpStatus !== null ? result.httpStatus : '—'}</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block">Duração</label>
              <p className="font-mono text-slate-700 dark:text-slate-300">{result.durationMs}ms</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block">Event ID</label>
              <p className="font-mono text-slate-700 dark:text-slate-300">{result.eventId ? String(result.eventId) : '—'}</p>
            </div>
          </div>

          {result.errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 rounded-xl">
              <label className="text-xs font-bold text-rose-600 dark:text-rose-400 block">Detalhes do Erro</label>
              <p className="text-sm text-rose-700 dark:text-rose-300 mt-1">{result.errorMessage}</p>
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-700/50">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sincronização realizada em {new Date().toLocaleString('pt-BR')}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

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
  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      onClose={loading ? undefined : onCancel}
      icon={variant === 'danger' ? <AlertTriangle size={18} className="text-red-500" /> : undefined}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'secondary'}
            size="md"
            onClick={onConfirm}
            loading={loading}
          >
            {loading ? 'Aguarde...' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{message}</p>
    </Modal>
  );
}

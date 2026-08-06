import type { DemandStatus, DemandPriority } from '../../types';
import { STATUS_BADGE_CLS, PRIORITY_BADGE_CLS, statusLabel, priorityLabel } from '../../lib/demandMeta';

interface StatusBadgeProps {
  status: DemandStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border whitespace-nowrap ${STATUS_BADGE_CLS[status] || STATUS_BADGE_CLS.pendente} ${className}`}>
      {statusLabel(status)}
    </span>
  );
}

interface PriorityBadgeProps {
  priority: DemandPriority;
  className?: string;
}

export function PriorityBadge({ priority, className = '' }: PriorityBadgeProps) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border whitespace-nowrap ${PRIORITY_BADGE_CLS[priority] || PRIORITY_BADGE_CLS.baixa} ${className}`}>
      {priorityLabel(priority)}
    </span>
  );
}

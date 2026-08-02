import type { DemandStatus, DemandPriority } from '../types';

export const STATUS_LABELS: Record<DemandStatus, string> = {
  pendente: 'Pendente',
  analise: 'Em Análise',
  concluido: 'Concluído',
  rejeitado: 'Rejeitado'
};

export const PRIORITY_LABELS: Record<DemandPriority, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  urgente: 'Urgente'
};

export const STATUS_BADGE_CLS: Record<DemandStatus, string> = {
  pendente: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50',
  analise: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50',
  concluido: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50',
  rejeitado: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/50'
};

export const PRIORITY_BADGE_CLS: Record<DemandPriority, string> = {
  baixa: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  media: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50',
  alta: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50',
  urgente: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/50'
};

export const STATUS_COLOR: Record<DemandStatus, string> = {
  pendente: '#f59e0b',
  analise: '#3b82f6',
  concluido: '#10b981',
  rejeitado: '#ef4444'
};

export const PRIORITY_COLOR: Record<DemandPriority, string> = {
  baixa: '#64748b',
  media: '#3b82f6',
  alta: '#f59e0b',
  urgente: '#ef4444'
};

export function statusLabel(status: DemandStatus): string {
  return STATUS_LABELS[status] || status;
}

export function priorityLabel(priority: DemandPriority): string {
  return PRIORITY_LABELS[priority] || priority;
}

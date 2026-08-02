import React, { useMemo } from 'react';
import {
  FilePlus2, Pencil, GitPullRequest, CheckCircle2, MessageSquare,
  Paperclip, Download, Trash2, RotateCcw, FileText, ArrowRight,
} from 'lucide-react';
import type { TimelineEvent, TimelineEventType } from '../../types';
import { StatusBadge } from '../ui';
import { statusLabel } from '../../lib/demandMeta';

interface DemandTimelineProps {
  events: TimelineEvent[];
}

interface TypeConfig {
  icon: React.ElementType;
  iconCls: string;
  verb: string;
}

const TYPE_CONFIG: Record<TimelineEventType, TypeConfig> = {
  created: { icon: FilePlus2, iconCls: 'text-emerald-600 bg-emerald-100 border-emerald-200', verb: 'cadastrou a demanda' },
  updated: { icon: Pencil, iconCls: 'text-blue-600 bg-blue-100 border-blue-200', verb: 'editou a demanda' },
  status_changed: { icon: GitPullRequest, iconCls: 'text-violet-600 bg-violet-100 border-violet-200', verb: 'alterou o status da demanda' },
  concluded: { icon: CheckCircle2, iconCls: 'text-emerald-600 bg-emerald-100 border-emerald-200', verb: 'concluiu a demanda' },
  comment: { icon: MessageSquare, iconCls: 'text-slate-600 bg-slate-100 border-slate-200', verb: 'comentou na demanda' },
  attachment: { icon: Paperclip, iconCls: 'text-amber-600 bg-amber-100 border-amber-200', verb: 'anexou arquivos' },
  export: { icon: Download, iconCls: 'text-teal-600 bg-teal-100 border-teal-200', verb: 'exportou dados da demanda' },
  deleted: { icon: Trash2, iconCls: 'text-red-600 bg-red-100 border-red-200', verb: 'excluiu a demanda' },
  restored: { icon: RotateCcw, iconCls: 'text-sky-600 bg-sky-100 border-sky-200', verb: 'restaurou a demanda' },
  note: { icon: FileText, iconCls: 'text-slate-600 bg-slate-100 border-slate-200', verb: 'registrou um despacho' },
};

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500',
  'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500', 'bg-fuchsia-500', 'bg-orange-500',
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Hoje';
  if (same(d, yesterday)) return 'Ontem';
  const label = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function DemandTimeline({ events }: DemandTimelineProps) {
  const sorted = useMemo(
    () => [...(events || [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [events]
  );

  if (sorted.length === 0) {
    return (
      <p className="text-[11px] text-slate-400 italic bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
        Nenhum trâmite registrado nesta demanda ainda.
      </p>
    );
  }

  let lastDay: string | null = null;

  return (
    <div className="space-y-1">
      {sorted.map((event) => {
        const type = event.event_type || 'note';
        const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.note;
        const Icon = cfg.icon;
        const dt = formatDateTime(event.created_at);
        const showDay = lastDay !== dayKey(event.created_at);
        lastDay = dayKey(event.created_at);
        const files = event.details?.file_names as string[] | undefined;
        const changedFields = event.details?.changed as string[] | undefined;
        const fromStatus = event.details?.from as string | undefined;
        const toStatus = event.status_changed_to || (event.details?.to as string | undefined);
        const exportType = event.details?.export_type as string | undefined;

        return (
          <React.Fragment key={event.id}>
            {showDay && (
              <div className="flex items-center gap-3 pt-2 pb-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{dayLabel(event.created_at)}</span>
                <span className="flex-1 h-px bg-slate-100 dark:bg-slate-700/50" />
              </div>
            )}
            <div className="relative flex gap-3 pb-5 pl-12">
              <span
                className={`absolute left-0 top-0 h-8 w-8 rounded-full ${avatarColor(event.user_name || '?')} text-white text-[11px] font-black flex items-center justify-center shadow-sm border-2 border-white dark:border-slate-800`}
              >
                {initials(event.user_name || '?')}
                <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border border-white dark:border-slate-800 flex items-center justify-center ${cfg.iconCls}`}>
                  <Icon size={9} strokeWidth={2.5} />
                </span>
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                  <strong className="text-slate-900 dark:text-white font-bold">{event.user_name}</strong>{' '}
                  {cfg.verb}
                  <span className="text-slate-400 dark:text-slate-500"> · {dt.date} às {dt.time}</span>
                </p>

                <div className="mt-1.5 rounded-xl border border-slate-100 dark:border-slate-700/50 bg-slate-50/70 dark:bg-slate-800/30 p-3">
                  {type === 'note' && event.title && (
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-1">{event.title}</p>
                  )}
                  {event.description && (
                    <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">
                      {event.description}
                    </p>
                  )}

                  {(fromStatus || toStatus) && (
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      {fromStatus && (
                        <>
                          <span className="text-[10px] text-slate-400">{statusLabel(fromStatus as any)}</span>
                          <ArrowRight size={11} className="text-slate-400" />
                        </>
                      )}
                      <StatusBadge status={toStatus as any} className="py-0.5" />
                    </div>
                  )}

                  {files && files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {files.slice(0, 3).map((f) => (
                        <span key={f} className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-md px-1.5 py-0.5 max-w-full truncate">
                          <Paperclip size={9} className="shrink-0 text-amber-500" /> {f}
                        </span>
                      ))}
                      {files.length > 3 && (
                        <span className="text-[10px] font-semibold text-slate-400">+{files.length - 3} arquivo(s)</span>
                      )}
                    </div>
                  )}

                  {changedFields && changedFields.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {changedFields.map((f) => (
                        <span key={f} className="text-[9px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800/50 rounded px-1.5 py-0.5">
                          {f.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {type === 'export' && (
                    <p className="mt-2 text-[10px] font-semibold text-teal-700 dark:text-teal-300 uppercase tracking-wide">
                      {(exportType || '').toUpperCase()}
                      {event.details?.record_count !== undefined && ` · ${event.details.record_count} registro(s)`}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default DemandTimeline;

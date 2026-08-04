import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, FolderKanban,   Clock, RefreshCw,
  Plus, Search, SlidersHorizontal, X, Check, AlertTriangle, CalendarDays, CheckCircle2,
  PanelRight, Pencil, Trash2, Flag, Paperclip, User, MapPin, ListFilter, FilterX,
  RotateCcw, GripVertical, Bell, ShieldAlert, Hourglass, PlusCircle, Undo2, FileText
} from 'lucide-react';
import { demandsApi, formatDateShort } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Demand, DemandStatus, DemandPriority } from '../../types';
import { Skeleton } from '../ui/Skeleton';
import { STATUS_LABELS, PRIORITY_LABELS, BRAZILIAN_STATES } from '../../lib/demandMeta';
import { StatusBadge, PageHeader, SummaryCard, Modal, FiltersDrawer, Select, Input } from '../ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType = 'demanda' | 'atualizacao' | 'prazo' | 'reuniao' | 'alerta' | 'outros';
type EventSource = 'system' | 'user';
type ViewMode = 'month' | 'week' | 'day';

interface CalEvent {
  id: string;
  title: string;
  description?: string;
  date: string;
  timeStart?: string;
  timeEnd?: string;
  type: EventType;
  status?: string | null;
  priority?: string;
  demandId?: string;
  municipality?: string;
  proposalNumber?: string;
  responsible?: string;
  source: EventSource;
  done?: boolean;
  color?: string;
  createdAt: string;
  updatedAt?: string;
}

interface AdvFilters {
  uf: string;
  municipality: string;
  status: string;
  responsible: string;
  ano: string;
  type: string;
  from: string;
  to: string;
  priority: string;
  search: string;
}

const EMPTY_ADV: AdvFilters = {
  uf: '', municipality: '', status: '', responsible: '', ano: '', type: '',
  from: '', to: '', priority: '', search: ''
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENTS_KEY = 'sgd_calendar_events_v1';

const TYPE_META: Record<EventType, { label: string; barCls: string; chip: string; dot: string }> = {
  demanda: {
    label: 'Demandas',
    barCls: 'bg-blue-100 text-blue-900 border-blue-200 hover:bg-blue-200 dark:bg-blue-900/60 dark:text-blue-100 dark:border-blue-800/60 dark:hover:bg-blue-800/60',
    chip: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50',
    dot: 'bg-blue-500'
  },
  atualizacao: {
    label: 'Atualizações',
    barCls: 'bg-emerald-100 text-emerald-900 border-emerald-200 hover:bg-emerald-200 dark:bg-emerald-900/60 dark:text-emerald-100 dark:border-emerald-800/60 dark:hover:bg-emerald-800/60',
    chip: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50',
    dot: 'bg-emerald-500'
  },
  prazo: {
    label: 'Prazos',
    barCls: 'bg-amber-100 text-amber-900 border-amber-200 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-800/60 dark:hover:bg-amber-800/50',
    chip: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50',
    dot: 'bg-amber-400'
  },
  reuniao: {
    label: 'Reuniões',
    barCls: 'bg-purple-100 text-purple-900 border-purple-200 hover:bg-purple-200 dark:bg-purple-900/60 dark:text-purple-100 dark:border-purple-800/60 dark:hover:bg-purple-800/60',
    chip: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/50',
    dot: 'bg-purple-500'
  },
  alerta: {
    label: 'Alertas',
    barCls: 'bg-red-100 text-red-900 border-red-200 hover:bg-red-200 dark:bg-red-900/60 dark:text-red-100 dark:border-red-800/60 dark:hover:bg-red-800/60',
    chip: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/50',
    dot: 'bg-red-500'
  },
  outros: {
    label: 'Outros',
    barCls: 'bg-slate-200 text-slate-800 border-slate-300 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700',
    chip: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    dot: 'bg-slate-400'
  }
};

const COLOR_SWATCHES = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b'
];

// ---------------------------------------------------------------------------
// Alerts model
// ---------------------------------------------------------------------------

const ALERTS_READ_KEY = 'sgd_calendar_alerts_read_v1';
const ALERTS_HISTORY_KEY = 'sgd_calendar_alerts_history_v1';

type AlertCategory = 'pendente' | 'prazo' | 'atualizacao' | 'cadastro' | 'conclusao';
type AlertLevel = 'atrasado' | 'proximo' | 'critico' | 'parado' | 'info';

interface AlertItem {
  id: string;
  category: AlertCategory;
  level: AlertLevel;
  title: string;
  description?: string;
  date: string;
  timeStart?: string;
  municipality?: string;
  proposalNumber?: string;
  responsible?: string;
  demandId?: string;
  read: boolean;
  readAt?: string;
  readBy?: string;
  createdAt: string;
}

const ALERT_FILTERS: { key: 'todos' | 'nao_lidos' | 'lidos' | AlertCategory; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'nao_lidos', label: 'Não lidos' },
  { key: 'lidos', label: 'Lidos' },
  { key: 'pendente', label: 'Pendentes' },
  { key: 'prazo', label: 'Prazo' },
  { key: 'atualizacao', label: 'Atualizações' },
  { key: 'cadastro', label: 'Cadastro' },
  { key: 'conclusao', label: 'Conclusão' }
];

const ALERT_LEVEL_META: Record<AlertLevel, { label: string; icon: React.ReactNode; cls: string }> = {
  atrasado: { label: 'Vencido', icon: <AlertTriangle size={14} className="text-red-500" />, cls: 'border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30' },
  proximo: { label: 'Próximo', icon: <Clock size={14} className="text-amber-500" />, cls: 'border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30' },
  critico: { label: 'Crítico', icon: <ShieldAlert size={14} className="text-purple-500" />, cls: 'border-purple-200 dark:border-purple-800/50 bg-purple-50 dark:bg-purple-950/30' },
  parado: { label: 'Parado', icon: <Hourglass size={14} className="text-slate-500" />, cls: 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50' },
  info: { label: 'Informativo', icon: <Bell size={14} className="text-blue-500" />, cls: 'border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-950/30' }
};

const CATEGORY_LABELS: Record<AlertCategory, string> = {
  pendente: 'Pendente', prazo: 'Prazo', atualizacao: 'Atualização', cadastro: 'Cadastro', conclusao: 'Conclusão'
};

const CATEGORY_TYPE: Record<AlertCategory, EventType> = {
  pendente: 'alerta', prazo: 'prazo', atualizacao: 'atualizacao', cadastro: 'demanda', conclusao: 'outros'
};

const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const ALL_TYPES: EventType[] = ['demanda', 'atualizacao', 'prazo', 'reuniao', 'alerta', 'outros'];

const SYSTEM_TYPE_MAP: Record<string, EventType> = {
  demand_created: 'demanda',
  demand_updated: 'atualizacao',
  timeline: 'outros'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

const toDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

const startOfWeek = (d: Date) => addDays(d, -d.getDay());

const dayDiff = (dateStr: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ev = new Date(`${dateStr}T00:00:00`);
  return Math.round((ev.getTime() - today.getTime()) / 86400000);
};

const parseTimeParts = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return { date: toDateStr(d), time: d.getHours() === 0 && d.getMinutes() === 0 ? '' : time };
};

const loadUserEvents = (): CalEvent[] => {
  try {
    return JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]') as CalEvent[];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Modal (genérico)
// ---------------------------------------------------------------------------

function Field({
  label, required, error, children, className = ''
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && <p className="text-[10px] text-red-500 font-semibold flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>}
    </div>
  );
}

const inputCls = (hasError = false) =>
  `w-full px-3.5 py-2.5 rounded-xl border text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900/60 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent transition-colors ${
    hasError ? 'border-red-400 bg-red-50/20 dark:bg-red-950/20' : 'border-slate-200 dark:border-slate-700'
  }`;

const selectCls =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900/60 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent transition-colors';

// ---------------------------------------------------------------------------
// Event Form Modal
// ---------------------------------------------------------------------------

interface EventFormState {
  type: EventType;
  title: string;
  description: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  responsible: string;
  demandId: string;
  municipality: string;
  status: DemandStatus;
  priority: DemandPriority;
  color: string;
}

const EMPTY_FORM = (date: string): EventFormState => ({
  type: 'reuniao', title: '', description: '', date, timeStart: '', timeEnd: '',
  responsible: '', demandId: '', municipality: '', status: 'pendente', priority: 'media', color: ''
});

function EventFormModal({
  open,
  initial,
  defaultDate,
  demands,
  onClose,
  onSave
}: {
  open: boolean;
  initial: CalEvent | null;
  defaultDate: string;
  demands: Demand[];
  onClose: () => void;
  onSave: (data: { state: EventFormState; editingId?: string }) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<EventFormState>(EMPTY_FORM(defaultDate));
  const [errors, setErrors] = useState<{ [k: string]: string }>({});

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        type: initial.type,
        title: initial.title,
        description: initial.description || '',
        date: initial.date,
        timeStart: initial.timeStart || '',
        timeEnd: initial.timeEnd || '',
        responsible: initial.responsible || user?.name || '',
        demandId: initial.demandId || '',
        municipality: initial.municipality || '',
        status: (initial.status as DemandStatus) || 'pendente',
        priority: (initial.priority as DemandPriority) || 'media',
        color: initial.color || ''
      });
    } else {
      setForm({ ...EMPTY_FORM(defaultDate), responsible: user?.name || '' });
    }
    setErrors({});
  }, [open, initial, defaultDate, user?.name]);

  const set = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleDemandLink = (id: string) => {
    set('demandId', id);
    if (id) {
      const d = demands.find(x => x.id === id);
      if (d) {
        set('municipality', d.municipality || form.municipality);
        if (d.responsible_name) set('responsible', d.responsible_name);
      }
    }
  };

  const handleSubmit = () => {
    const errs: { [k: string]: string } = {};
    if (!form.title.trim()) errs.title = 'Informe o título do evento.';
    if (!form.date) errs.date = 'Informe a data.';
    if (form.timeStart && form.timeEnd && form.timeStart >= form.timeEnd) errs.timeEnd = 'Hora final deve ser maior que a inicial.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSave({ state: form, editingId: initial?.id });
  };

  return (
    <Modal
      open={open}
      title={initial ? 'Editar Evento' : 'Novo Evento'}
      subtitle={initial ? 'Atualize as informações do evento.' : 'Registre uma nova atividade no calendário.'}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center gap-2"
          >
            <Check size={14} /> Salvar
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Tipo" required>
          <select value={form.type} onChange={e => set('type', e.target.value as EventType)} className={selectCls}>
            {ALL_TYPES.map(t => (
              <option key={t} value={t}>{TYPE_META[t].label}</option>
            ))}
          </select>
        </Field>
        <Field label="Cor">
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {COLOR_SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => set('color', form.color === c ? '' : c)}
                className={`w-7 h-7 rounded-full transition-all cursor-pointer ${
                  form.color === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-slate-500 scale-110' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Cor ${c}`}
              />
            ))}
            {form.color && (
              <button type="button" onClick={() => set('color', '')} className="text-[10px] font-bold text-slate-400 hover:text-slate-600">
                Limpar
              </button>
            )}
          </div>
        </Field>
        <Field label="Título" required error={errors.title} className="sm:col-span-2">
          <input
            type="text"
            value={form.title}
            onChange={e => set('title', e.target.value.toUpperCase())}
            placeholder="Ex: Reunião com FNDE"
            className={inputCls(!!errors.title)}
          />
        </Field>
        <Field label="Descrição" className="sm:col-span-2">
          <textarea
            rows={3}
            value={form.description}
            onChange={e => set('description', e.target.value.toUpperCase())}
            placeholder="Detalhes do evento..."
            className={`${inputCls(false)} resize-y min-h-[80px]`}
          />
        </Field>
        <Field label="Data" required error={errors.date}>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls(!!errors.date)} />
        </Field>
        <Field label="Responsável">
          <input
            type="text"
            value={form.responsible}
            onChange={e => set('responsible', e.target.value.toUpperCase())}
            placeholder="Nome do responsável"
            className={inputCls(false)}
          />
        </Field>
        <Field label="Hora Inicial">
          <input type="time" value={form.timeStart} onChange={e => set('timeStart', e.target.value)} className={selectCls} />
        </Field>
        <Field label="Hora Final" error={errors.timeEnd}>
          <input type="time" value={form.timeEnd} onChange={e => set('timeEnd', e.target.value)} className={selectCls} />
        </Field>
        <Field label="Relacionar com Demanda" className="sm:col-span-2">
          <select
            value={form.demandId}
            onChange={e => handleDemandLink(e.target.value)}
            className={selectCls}
          >
            <option value="">Sem vínculo</option>
            {demands.map(d => (
              <option key={d.id} value={d.id}>{d.proposal_number ? `[${d.proposal_number}] ` : ''}{d.title} — {d.municipality}/{d.uf}</option>
            ))}
          </select>
        </Field>
        <Field label="Município">
          <input
            type="text"
            value={form.municipality}
            onChange={e => set('municipality', e.target.value.toUpperCase())}
            placeholder="Município do evento"
            className={inputCls(false)}
          />
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={e => set('status', e.target.value as DemandStatus)} className={selectCls}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Prioridade">
          <select value={form.priority} onChange={e => set('priority', e.target.value as DemandPriority)} className={selectCls}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function CalendarView({ onOpenDemand }: { onOpenDemand?: (demandId: string) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [apiEvents, setApiEvents] = useState<CalEvent[]>([]);
  const [userEvents, setUserEvents] = useState<CalEvent[]>(() => loadUserEvents());
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [quickFilters, setQuickFilters] = useState<EventType[]>([]);
  const [hideSystem, setHideSystem] = useState(false);
  const [search, setSearch] = useState('');
  const [advFilters, setAdvFilters] = useState<AdvFilters>(EMPTY_ADV);
  const [draft, setDraft] = useState<AdvFilters>(EMPTY_ADV);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const [newEventDate, setNewEventDate] = useState(toDateStr(new Date()));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragoverDay, setDragoverDay] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  const [demands, setDemands] = useState<Demand[]>([]);
  const [detailTimeline, setDetailTimeline] = useState<any[]>([]);

  // ---- Alerts state (read/history persisted) ----
  const [readIds, setReadIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(ALERTS_READ_KEY) || '[]') as string[]; } catch { return []; }
  });
  const [history, setHistory] = useState<AlertItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(ALERTS_HISTORY_KEY) || '[]') as AlertItem[]; } catch { return []; }
  });
  const [closingId, setClosingId] = useState<string | null>(null);
  const [alertTab, setAlertTab] = useState<'ativos' | 'historico'>('ativos');
  const [alertFilter, setAlertFilter] = useState<'todos' | 'nao_lidos' | 'lidos' | AlertCategory>('todos');

  // ---- Load data ----
  const load = async () => {
    setLoading(true);
    try {
      const data = await demandsApi.getCalendarEvents();
      const normalized: CalEvent[] = (data as any[]).map((e: any) => {
        const { date, time } = parseTimeParts(e.date);
        return {
          id: e.id,
          title: e.title,
          date,
          timeStart: time || undefined,
          type: SYSTEM_TYPE_MAP[e.type] || 'outros',
          status: e.status || null,
          priority: e.priority,
          demandId: e.demandId,
          source: 'system' as EventSource,
          createdAt: e.date
        };
      });
      setApiEvents(normalized);
    } catch (err) {
      console.error('Calendar load error', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    demandsApi.getAll({ limit: 200, page: 1 }).then(r => setDemands(r.data)).catch(() => {});
  }, []);

  // Persist user events
  const persistUserEvents = (next: CalEvent[]) => {
    setUserEvents(next);
    localStorage.setItem(EVENTS_KEY, JSON.stringify(next));
  };

  // ---- Derived ----
  const allEvents = useMemo(() => [...userEvents, ...apiEvents], [userEvents, apiEvents]);

  const filteredEvents = useMemo(() => {
    const q = advFilters.search.trim().toLowerCase();
    return allEvents.filter(e => {
      if (e.source === 'system' && hideSystem) return false;
      if (quickFilters.length > 0 && !quickFilters.includes(e.type)) return false;
      if (e.done) return false;
      const year = e.date.slice(0, 4);
      if (advFilters.uf && e.municipality && !e.municipality.includes(advFilters.uf)) return false;
      if (advFilters.municipality && !String(e.municipality || '').toUpperCase().includes(advFilters.municipality.toUpperCase())) return false;
      if (advFilters.status && e.status !== advFilters.status) return false;
      if (advFilters.responsible && String(e.responsible || '').toUpperCase() !== advFilters.responsible.toUpperCase()) return false;
      if (advFilters.ano && year !== advFilters.ano) return false;
      if (advFilters.type && e.type !== advFilters.type) return false;
      if (advFilters.priority && e.priority !== advFilters.priority) return false;
      if (advFilters.from && e.date < advFilters.from) return false;
      if (advFilters.to && e.date > advFilters.to) return false;
      if (q && ![
        e.title, e.description, e.municipality, e.proposalNumber, e.responsible
      ].some(x => String(x ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [allEvents, hideSystem, quickFilters, advFilters]);

  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredEvents;
    return filteredEvents.filter(e =>
      [e.title, e.description, e.municipality, e.proposalNumber, e.responsible]
        .some(x => String(x ?? '').toLowerCase().includes(q))
    );
  }, [filteredEvents, search]);

  const year = current.getFullYear();
  const month = current.getMonth();

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    searchFiltered.forEach(e => {
      (map[e.date] = map[e.date] || []).push(e);
    });
    Object.values(map).forEach(list => list.sort((a, b) => (a.timeStart || '99').localeCompare(b.timeStart || '99')));
    return map;
  }, [searchFiltered]);

  // Month grid cells (6 weeks)
  const monthCells = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = startOfWeek(first);
    return Array.from({ length: 42 }).map((_, i) => addDays(start, i));
  }, [year, month]);

  const weekCells = useMemo(() => {
    const start = startOfWeek(current);
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [current]);

  // ---- KPIs ----
  const monthKey = `${year}-${pad2(month + 1)}`;
  const kpis = useMemo(() => {
    const inMonth = filteredEvents.filter(e => e.date.startsWith(monthKey));
    const pendentes = inMonth.filter(e => e.status === 'pendente' || e.status === 'analise').length;
    const concluidas = inMonth.filter(e => e.status === 'concluido').length;
    return { eventosMes: inMonth.length, pendentes, concluidas };
  }, [filteredEvents, monthKey]);

  const derivedAlerts = useMemo(() => {
    const list: AlertItem[] = [];
    const demandById = new Map(demands.map(d => [d.id, d]));
    const enrich = (e: CalEvent): Partial<AlertItem> => {
      const d = e.demandId ? demandById.get(e.demandId) : undefined;
      return {
        demandId: e.demandId,
        municipality: d?.municipality || e.municipality,
        proposalNumber: d?.proposal_number,
        responsible: d?.responsible_name || e.responsible
      };
    };
    filteredEvents.forEach(e => {
      if (e.done) return;
      const diff = dayDiff(e.date);
      const meta = enrich(e);
      if (e.type === 'prazo' || e.type === 'alerta' || e.type === 'reuniao') {
        if (diff < 0) {
          list.push({ id: `prazo-atrasado-${e.id}`, category: 'prazo', level: 'atrasado', title: `Prazo vencido: ${e.title}`, description: e.description, date: e.date, timeStart: e.timeStart, createdAt: e.createdAt, read: false, ...meta });
        } else if (diff <= 7) {
          list.push({ id: `prazo-proximo-${e.id}`, category: 'prazo', level: 'proximo', title: `Prazo próximo: ${e.title}`, description: e.description, date: e.date, timeStart: e.timeStart, createdAt: e.createdAt, read: false, ...meta });
        }
      }
      if ((e.priority === 'urgente' || e.priority === 'alta') && e.status && ['pendente', 'analise'].includes(e.status)) {
        list.push({ id: `critico-${e.id}`, category: 'pendente', level: 'critico', title: `Demanda crítica: ${e.title}`, date: e.date, timeStart: e.timeStart, createdAt: e.createdAt, read: false, ...meta });
      }
    });
    apiEvents
      .filter(e => e.type === 'atualizacao' && e.status && ['pendente', 'analise'].includes(e.status) && dayDiff(e.date) < -15)
      .slice(0, 8)
      .forEach(e => {
        list.push({ id: `parado-${e.id}`, category: 'atualizacao', level: 'parado', title: `Sem atualização há +15 dias: ${e.title}`, date: e.date, createdAt: e.createdAt, read: false, ...enrich(e) });
      });
    demands
      .filter(d => (d.priority === 'urgente' || d.priority === 'alta') && ['pendente', 'analise'].includes(d.status))
      .filter(d => { const df = dayDiff(toDateStr(new Date(d.created_at))); return df >= -3 && df <= 0; })
      .slice(0, 8)
      .forEach(d => {
        list.push({ id: `cadastro-${d.id}`, category: 'cadastro', level: 'info', title: `Nova demanda: ${d.title}`, municipality: d.municipality, proposalNumber: d.proposal_number, responsible: d.responsible_name, demandId: d.id, date: toDateStr(new Date(d.created_at)), createdAt: d.created_at, read: false });
      });
    apiEvents
      .filter(e => e.type === 'atualizacao' && e.status === 'concluido')
      .filter(e => { const df = dayDiff(e.date); return df >= 0 && df <= 3; })
      .slice(0, 8)
      .forEach(e => {
        list.push({ id: `conclusao-${e.id}`, category: 'conclusao', level: 'info', title: `Demanda concluída: ${e.title}`, date: e.date, createdAt: e.createdAt, read: false, ...enrich(e) });
      });
    const order: Record<AlertLevel, number> = { atrasado: 0, critico: 1, proximo: 2, parado: 3, info: 4 };
    return list.sort((a, b) => (order[a.level] - order[b.level]) || (a.date + (a.timeStart || '99')).localeCompare(b.date + (b.timeStart || '99')));
  }, [filteredEvents, apiEvents, demands]);

  const activeAlerts = useMemo(
    () => derivedAlerts.filter(a => !readIds.includes(a.id)),
    [derivedAlerts, readIds]
  );

  const filteredActiveAlerts = useMemo(() => {
    if (alertFilter === 'todos' || alertFilter === 'nao_lidos' || alertFilter === 'lidos') return activeAlerts;
    return activeAlerts.filter(a => a.category === alertFilter);
  }, [activeAlerts, alertFilter]);

  const filteredHistoryAlerts = useMemo(() => {
    let list = [...history].sort((a, b) => (b.readAt || '').localeCompare(a.readAt || ''));
    if (alertFilter === 'nao_lidos') list = list.filter(a => !a.read);
    else if (alertFilter === 'lidos') list = list.filter(a => a.read);
    else if (alertFilter !== 'todos') list = list.filter(a => a.category === alertFilter);
    return list;
  }, [history, alertFilter]);

  const unreadCount = activeAlerts.length;

  const upcoming = useMemo(() => {
    const todayStr = toDateStr(new Date());
    return searchFiltered
      .filter(e => !e.done && e.date >= todayStr)
      .sort((a, b) => (a.date + (a.timeStart || '99')).localeCompare(b.date + (b.timeStart || '99')))
      .slice(0, 8);
  }, [searchFiltered]);

  const activeFilterCount = Object.values(advFilters).filter(v => String(v ?? '').trim() !== '').length;
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(current);

  const uniqueUfs = [...new Set(allEvents.map(e => e.municipality ? e.municipality.split('/').pop() : '').filter(Boolean))].sort();
  const ufs = uniqueUfs.length > 0 ? uniqueUfs : BRAZILIAN_STATES;
  const municipalities = [...new Set(allEvents.map(e => e.municipality).filter(Boolean))].sort((a, b) => a!.localeCompare(b!, 'pt-BR'));
  const responsibles = [...new Set(allEvents.map(e => e.responsible).filter(Boolean))].sort();
  const years = [...new Set(allEvents.map(e => e.date.slice(0, 4))).add(String(new Date().getFullYear()))].sort((a, b) => b.localeCompare(a));
  const eventTypes = [...new Set(allEvents.map(e => e.type))];

  // ---- Handlers ----
  const prev = () => {
    if (viewMode === 'month') setCurrent(new Date(year, month - 1, 1));
    else if (viewMode === 'week') setCurrent(addDays(current, -7));
    else setCurrent(addDays(current, -1));
  };
  const next = () => {
    if (viewMode === 'month') setCurrent(new Date(year, month + 1, 1));
    else if (viewMode === 'week') setCurrent(addDays(current, 7));
    else setCurrent(addDays(current, 1));
  };
  const goToday = () => setCurrent(new Date());

  const openNewEvent = (date?: string) => {
    setEditingEvent(null);
    setNewEventDate(date || toDateStr(current));
    setModalOpen(true);
  };

  const handleSaveEvent = ({ state, editingId }: { state: EventFormState; editingId?: string }) => {
    const now = new Date().toISOString();
    if (editingId) {
      const next = userEvents.map(ev => ev.id === editingId
        ? { ...ev, ...state, updatedAt: now }
        : ev);
      persistUserEvents(next);
      toast('success', 'Evento atualizado');
    } else {
      const ev: CalEvent = {
        id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...state,
        source: 'user',
        createdAt: now
      };
      persistUserEvents([...userEvents, ev]);
      toast('success', 'Evento criado');
    }
    setModalOpen(false);
  };

  const deleteEvent = (ev: CalEvent) => {
    if (!window.confirm(`Excluir o evento "${ev.title}"?`)) return;
    persistUserEvents(userEvents.filter(e => e.id !== ev.id));
    setSelectedEvent(null);
    toast('success', 'Evento excluído');
  };

  const toggleDone = (ev: CalEvent) => {
    const next = userEvents.map(e => e.id === ev.id ? { ...e, done: !e.done, updatedAt: new Date().toISOString() } : e);
    persistUserEvents(next);
    setSelectedEvent(prev => prev ? { ...prev, done: !prev.done } : null);
    toast('success', ev.done ? 'Evento reaberto' : 'Evento concluído');
  };

  const openEdit = (ev: CalEvent) => {
    setEditingEvent(ev);
    setNewEventDate(ev.date);
    setModalOpen(true);
  };

  // ---- Alerts handlers ----
  const markAlertRead = (a: AlertItem) => {
    setClosingId(a.id);
    window.setTimeout(() => {
      setReadIds(prev => {
        const next = prev.includes(a.id) ? prev : [...prev, a.id];
        localStorage.setItem(ALERTS_READ_KEY, JSON.stringify(next));
        return next;
      });
      setHistory(prev => {
        const next = prev.filter(x => x.id !== a.id);
        next.push({ ...a, read: true, readAt: new Date().toISOString(), readBy: user?.name || '—' });
        localStorage.setItem(ALERTS_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
      setClosingId(null);
    }, 200);
  };

  const openAlertDemand = (a: AlertItem) => {
    markAlertRead(a);
    if (a.demandId && onOpenDemand) onOpenDemand(a.demandId);
  };

  const restoreAlert = (a: AlertItem) => {
    setHistory(prev => {
      const next = prev.filter(x => x.id !== a.id);
      localStorage.setItem(ALERTS_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
    setReadIds(prev => {
      const next = prev.filter(x => x !== a.id);
      localStorage.setItem(ALERTS_READ_KEY, JSON.stringify(next));
      return next;
    });
    toast('success', 'Alerta restaurado');
  };

  const deleteAlertPermanently = (a: AlertItem) => {
    setHistory(prev => {
      const next = prev.filter(x => x.id !== a.id);
      localStorage.setItem(ALERTS_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
    setReadIds(prev => {
      const next = prev.includes(a.id) ? prev : [...prev, a.id];
      localStorage.setItem(ALERTS_READ_KEY, JSON.stringify(next));
      return next;
    });
    toast('success', 'Alerta excluído permanentemente');
  };

  const renderAlertIcon = (a: AlertItem) => {
    if (a.category === 'cadastro') return <PlusCircle size={14} className="text-blue-500" />;
    if (a.category === 'conclusao') return <CheckCircle2 size={14} className="text-emerald-500" />;
    return ALERT_LEVEL_META[a.level].icon;
  };

  // Drag & Drop
  const handleDragStart = (e: React.DragEvent, ev: CalEvent) => {
    if (ev.source !== 'user') { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', ev.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragId(ev.id);
  };
  const handleDragOver = (e: React.DragEvent, day: string) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragoverDay(day);
  };
  const handleDrop = (e: React.DragEvent, day: string) => {
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData('text/plain');
    setDragoverDay(null);
    setDragId(null);
    if (!id) return;
    const target = userEvents.find(x => x.id === id);
    if (!target || target.date === day) return;
    const next = userEvents.map(x => x.id === id ? { ...x, date: day, updatedAt: new Date().toISOString() } : x);
    persistUserEvents(next);
    toast('success', 'Evento movido', `${target.title} → ${formatDateShort(day)}`);
  };
  const handleDragEnd = () => {
    setDragoverDay(null);
    setDragId(null);
  };

  // Detail timeline for linked demand
  useEffect(() => {
    if (!selectedEvent?.demandId) { setDetailTimeline([]); return; }
    demandsApi.getById(selectedEvent.demandId)
      .then(d => setDetailTimeline((d.timeline || []).slice(0, 10)))
      .catch(() => setDetailTimeline([]));
  }, [selectedEvent?.demandId]);

  // ---- Filters drawer ----
  const openFilters = () => {
    setDraft({ ...advFilters });
    setFiltersOpen(true);
  };
  const closeFilters = () => setFiltersOpen(false);
  const applyFilters = () => {
    setAdvFilters({ ...draft });
    setFiltersOpen(false);
  };
  const clearAllFilters = () => {
    setAdvFilters(EMPTY_ADV);
    setDraft(EMPTY_ADV);
    setFiltersOpen(false);
  };

  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFilters(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtersOpen]);

  // ---- Event bar (shared by views) ----
  const renderEventBar = (e: CalEvent, compact: boolean) => {
    const isCustom = !!e.color;
    const cls = compact
      ? `inline-flex items-center gap-1 max-w-full rounded px-1 py-[3px] text-[9px] font-bold truncate cursor-pointer hover:brightness-110 transition-all border ${isCustom ? 'text-white border-transparent' : TYPE_META[e.type].barCls}`
      : `inline-flex items-center gap-1 max-w-full rounded px-1.5 py-1 text-[10px] font-bold truncate cursor-pointer hover:brightness-110 transition-all border ${isCustom ? 'text-white border-transparent' : TYPE_META[e.type].barCls}`;
    return (
      <button
        key={e.id}
        type="button"
        draggable={e.source === 'user'}
        onDragStart={(ev) => handleDragStart(ev, e)}
        onDragEnd={handleDragEnd}
        onClick={() => setSelectedEvent(e)}
        title={`${e.title}${e.timeStart ? ` — ${e.timeStart}` : ''}${e.responsible ? ` — ${e.responsible}` : ''}`}
        className={`${cls} ${e.done ? 'opacity-50 line-through' : ''}`}
        style={isCustom ? { backgroundColor: e.color } : undefined}
      >
        {e.source === 'user' && <GripVertical size={compact ? 8 : 10} className="shrink-0 opacity-70" />}
        {e.timeStart && <span className="shrink-0 font-black">{e.timeStart}</span>}
        <span className="truncate">{e.title}</span>
      </button>
    );
  };

  const renderDayCell = (day: Date, isMuted: boolean, isTarget: boolean) => {
    const ds = toDateStr(day);
    const dayEvents = eventsByDay[ds] || [];
    const isToday = ds === toDateStr(new Date());
    return (
      <div
        key={ds}
        onDragOver={(e) => handleDragOver(e, ds)}
        onDragLeave={() => setDragoverDay(prev => prev === ds ? null : prev)}
        onDrop={(e) => handleDrop(e, ds)}
        onDoubleClick={() => openNewEvent(ds)}
        title="Duplo clique para criar evento"
        className={`relative min-h-[84px] rounded-xl border p-1.5 text-xs transition-all cursor-pointer ${
          dragoverDay === ds ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30 ring-2 ring-brand-300 dark:ring-brand-800' : ''
        } ${
          isToday
            ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 shadow-sm'
            : isMuted
            ? 'border-slate-100/70 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/30'
            : 'border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-900/40 hover:border-brand-200 dark:hover:border-brand-800'
        }`}
      >
        <div className="flex items-center justify-between px-0.5">
          <span
            className={`text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full ${
              isToday ? 'bg-brand-600 text-white' : isMuted ? 'text-slate-400 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {day.getDate()}
          </span>
          {dayEvents.length > 0 && (
            <span className="text-[8px] font-bold text-slate-400">{dayEvents.length}</span>
          )}
        </div>
        <div className="space-y-1 mt-1">
          {dayEvents.slice(0, 3).map(e => renderEventBar(e, true))}
          {dayEvents.length > 3 && (
            <div className="text-[8px] font-bold text-slate-400 px-1">+{dayEvents.length - 3} mais</div>
          )}
        </div>
        {isTarget && <span className="absolute inset-0 rounded-xl border-2 border-dashed border-brand-400 pointer-events-none" />}
      </div>
    );
  };

  const renderWeekDayCol = (day: Date) => {
    const ds = toDateStr(day);
    const dayEvents = eventsByDay[ds] || [];
    const isToday = ds === toDateStr(new Date());
    return (
      <div
        key={ds}
        onDragOver={(e) => handleDragOver(e, ds)}
        onDragLeave={() => setDragoverDay(prev => prev === ds ? null : prev)}
        onDrop={(e) => handleDrop(e, ds)}
        onDoubleClick={() => openNewEvent(ds)}
        className={`min-h-[140px] rounded-xl border p-1.5 transition-all cursor-pointer ${
          dragoverDay === ds ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30 ring-2 ring-brand-300 dark:ring-brand-800' : ''
        } ${
          isToday ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30' : 'border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-900/40'
        }`}
      >
        <div className={`text-center text-[10px] font-black py-1 rounded-lg mb-1 ${isToday ? 'text-white bg-brand-600' : 'text-slate-500 dark:text-slate-400'}`}>
          {WEEK_DAYS[day.getDay()]} {day.getDate()}
        </div>
        <div className="space-y-1">
          {dayEvents.map(e => renderEventBar(e, false))}
          {dayEvents.length === 0 && (
            <p className="text-[9px] text-slate-300 dark:text-slate-600 text-center pt-4">Sem eventos</p>
          )}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const ds = toDateStr(current);
    const dayEvents = eventsByDay[ds] || [];
    const isToday = ds === toDateStr(new Date());
    return (
      <div
        onDragOver={(e) => handleDragOver(e, ds)}
        onDragLeave={() => setDragoverDay(null)}
        onDrop={(e) => handleDrop(e, ds)}
        onDoubleClick={() => openNewEvent(ds)}
        className={`rounded-xl border p-3 space-y-2 cursor-pointer transition-all ${
          dragoverDay === ds ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30 ring-2 ring-brand-300 dark:ring-brand-800' : ''
        } ${isToday ? 'border-brand-500 bg-brand-50/40 dark:bg-brand-950/20' : 'border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-900/40'}`}
      >
        <div className="flex items-center gap-2 px-1 pb-2 border-b border-slate-100 dark:border-slate-700/50">
          <CalendarDays size={14} className="text-brand-600" />
          <span className="text-xs font-black text-slate-700 dark:text-slate-200 capitalize">
            {new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(current)}
          </span>
          <span className="text-[9px] font-bold text-slate-400">{dayEvents.length} evento(s)</span>
        </div>
        <div className="space-y-1.5">
          {dayEvents.map(e => renderEventBar(e, false))}
          {dayEvents.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8 italic">Nenhum evento neste dia. Duplo clique para criar.</p>
          )}
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* HEADER */}
      <PageHeader
        title="Calendário de Atividades"
        subtitle="Visualize, acompanhe e gerencie todas as atividades, prazos e demandas em um único lugar."
        icon={<CalendarIcon className="text-blue-600 dark:text-blue-400" size={26} />}
        actions={
          <>
            <button
              onClick={openFilters}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-colors ${
                activeFilterCount > 0
                  ? 'bg-brand-50 dark:bg-brand-950/30 border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-300'
                  : 'bg-white dark:bg-[#111a2e] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal size={15} /> Filtros
              {activeFilterCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[9px] font-black flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              onClick={goToday}
              className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111a2e] text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Hoje
            </button>
            <button
              onClick={() => openNewEvent()}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-sm transition-all"
            >
              <Plus size={15} /> Novo Evento
            </button>
            <button
              onClick={() => setPanelOpen(p => !p)}
              className={`lg:hidden p-2.5 rounded-xl border text-xs font-bold transition-colors ${
                panelOpen
                  ? 'bg-brand-50 dark:bg-brand-950/30 border-brand-300 text-brand-700'
                  : 'bg-white dark:bg-[#111a2e] border-slate-200 dark:border-slate-700 text-slate-600'
              }`}
              title={panelOpen ? 'Ocultar painel' : 'Mostrar painel'}
            >
              <PanelRight size={15} />
            </button>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          label="Eventos do Mês"
          value={kpis.eventosMes}
          icon={<CalendarDays size={16} className="text-blue-600 dark:text-blue-400" />}
          iconBgCls="bg-blue-50 dark:bg-blue-950/40"
        />
        <SummaryCard
          label="Demandas Pendentes"
          value={kpis.pendentes}
          icon={<FolderKanban size={16} className="text-amber-600 dark:text-amber-400" />}
          iconBgCls="bg-amber-50 dark:bg-amber-950/40"
        />
        <SummaryCard
          label="Demandas Concluídas"
          value={kpis.concluidas}
          icon={<CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />}
          iconBgCls="bg-emerald-50 dark:bg-emerald-950/40"
        />
        <SummaryCard
          label="Alertas Ativos"
          value={unreadCount}
          icon={<AlertTriangle size={16} className={unreadCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'} />}
          iconBgCls={unreadCount > 0 ? 'bg-red-50 dark:bg-red-950/40' : 'bg-slate-100 dark:bg-slate-800'}
          valueCls={`text-lg font-black leading-tight ${unreadCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white'}`}
        />
      </div>

      {/* CONTENT */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
        {/* CALENDAR */}
        <div className="min-w-0 bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 md:p-5 shadow-sm space-y-4">
          {/* Nav */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <button onClick={prev} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600" title="Anterior">
                <ChevronLeft size={16} />
              </button>
              <span className="capitalize font-black text-slate-800 dark:text-white text-sm min-w-[130px] text-center">{monthName}</span>
              <button onClick={next} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600" title="Próximo">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              {(['month', 'week', 'day'] as ViewMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-all ${
                    viewMode === m ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {m === 'month' ? 'Mês' : m === 'week' ? 'Semana' : 'Dia'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-1 py-4">
              {Array.from({ length: 42 }).map((_, i) => (
                <div key={i} className="aspect-square p-1">
                  <Skeleton className="w-full h-full rounded-lg" />
                </div>
              ))}
            </div>
          ) : viewMode === 'month' ? (
            <>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEK_DAYS.map(w => (
                  <div key={w} className="text-center text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 py-1">{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthCells.map(d => renderDayCell(d, d.getMonth() !== month, d.getMonth() !== month))}
              </div>
            </>
          ) : viewMode === 'week' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-1.5">
              {weekCells.map(d => renderWeekDayCol(d))}
            </div>
          ) : (
            renderDayView()
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 border-t border-slate-100 dark:border-slate-700/50">
            {ALL_TYPES.map(t => (
              <span key={t} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                <span className={`w-2.5 h-2.5 rounded-full ${TYPE_META[t].dot}`} />
                {TYPE_META[t].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-400 ml-auto">
              <RefreshCw size={11} /> Duplo clique cria · Arraste eventos próprios
            </span>
          </div>
        </div>

        {/* SIDEBAR */}
        <aside className={`${panelOpen ? 'block' : 'hidden'} xl:block xl:sticky xl:top-6 space-y-4 self-start w-full min-w-0`}>
          {/* Quick search */}
          <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-3.5 shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Pesquisa instantânea..."
                className="w-full pl-8 pr-7 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpar">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Alerts Center */}
          <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-black text-slate-800 dark:text-white flex items-center gap-1.5">
              <Bell size={14} className="text-brand-600" /> Central de Alertas
              {unreadCount > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-black animate-alert-in">
                  {unreadCount}
                </span>
              )}
            </h3>

            {/* Filters */}
            <div className="flex flex-wrap gap-1">
              {ALERT_FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setAlertFilter(f.key)}
                  className={`px-2 py-1 rounded-full text-[9px] font-bold border transition-colors ${
                    alertFilter === f.key
                      ? 'bg-slate-900 text-white border-slate-950 dark:bg-brand-600 dark:border-brand-600'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setAlertTab('ativos')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  alertTab === 'ativos' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Ativos{activeAlerts.length > 0 ? ` (${activeAlerts.length})` : ''}
              </button>
              <button
                onClick={() => setAlertTab('historico')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  alertTab === 'historico' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Histórico{history.length > 0 ? ` (${history.length})` : ''}
              </button>
            </div>

            {/* Active list */}
            {alertTab === 'ativos' ? (
              filteredActiveAlerts.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">Nenhum alerta ativo. Tudo em dia!</p>
              ) : (
                <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
                  {filteredActiveAlerts.map(a => (
                    <div
                      key={a.id}
                      className={`flex items-start gap-2 p-2 rounded-lg border text-[10px] ${ALERT_LEVEL_META[a.level].cls} ${closingId === a.id ? 'animate-alert-out' : 'animate-alert-in'}`}
                    >
                      <span className="mt-0.5 shrink-0">{renderAlertIcon(a)}</span>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => (a.demandId ? openAlertDemand(a) : markAlertRead(a))}
                          className={`text-left font-bold truncate block w-full ${a.demandId ? 'hover:underline' : ''} ${
                            a.level === 'atrasado' ? 'text-red-800 dark:text-red-200'
                            : a.level === 'proximo' ? 'text-amber-800 dark:text-amber-200'
                            : a.level === 'critico' ? 'text-purple-800 dark:text-purple-200'
                            : 'text-slate-800 dark:text-slate-200'
                          }`}
                          title={a.demandId ? 'Abrir demanda' : undefined}
                        >
                          {a.title}
                        </button>
                        {a.description && <p className="text-[9px] opacity-80 mt-0.5 line-clamp-2">{a.description}</p>}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[9px] text-slate-500 dark:text-slate-400 font-mono">
                          <span className="inline-flex items-center gap-0.5"><CalendarDays size={9} /> {formatDateShort(a.date)}{a.timeStart ? ` ${a.timeStart}` : ''}</span>
                          {a.municipality && <span className="inline-flex items-center gap-0.5"><MapPin size={9} /> {a.municipality}</span>}
                          {a.proposalNumber && <span className="inline-flex items-center gap-0.5"><FileText size={9} /> {a.proposalNumber}</span>}
                          {a.responsible && <span className="inline-flex items-center gap-0.5"><User size={9} /> {a.responsible}</span>}
                        </div>
                        <span className={`mt-1 inline-block px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wide ${
                          a.read ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300' : 'bg-brand-600 text-white'
                        }`}>
                          {a.read ? 'Lido' : 'Novo'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => markAlertRead(a)}
                          title="Marcar como lido"
                          className="p-1 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => markAlertRead(a)}
                          title="Fechar alerta"
                          className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : filteredHistoryAlerts.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic">Histórico vazio.</p>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
                {filteredHistoryAlerts.map(a => (
                  <div key={a.id} className="flex items-start gap-2 p-2 rounded-lg border border-slate-100 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-800/40 text-[10px] animate-alert-in">
                    <span className="mt-0.5 shrink-0 opacity-70">{renderAlertIcon(a)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-700 dark:text-slate-200 truncate">{a.title}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[9px] text-slate-400 font-mono">
                        <span className="inline-flex items-center gap-0.5"><CalendarDays size={9} /> {formatDateShort(a.date)}{a.timeStart ? ` ${a.timeStart}` : ''}</span>
                        {a.municipality && <span className="inline-flex items-center gap-0.5"><MapPin size={9} /> {a.municipality}</span>}
                        {a.proposalNumber && <span className="inline-flex items-center gap-0.5"><FileText size={9} /> {a.proposalNumber}</span>}
                      </div>
                      <p className="text-[9px] text-slate-400 mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-0.5"><Check size={9} className="text-emerald-500" /> {a.readAt ? `Lido em ${formatDateShort(a.readAt.slice(0, 10))} ${a.readAt.slice(11, 16)}` : 'Lido'}</span>
                        <span className="inline-flex items-center gap-0.5"><User size={9} /> {a.readBy || '—'}</span>
                        <span className={`px-1 py-0.5 rounded border font-bold ${TYPE_META[CATEGORY_TYPE[a.category]].chip}`}>{CATEGORY_LABELS[a.category]}</span>
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => restoreAlert(a)}
                        title="Restaurar alerta"
                        className="p-1 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                      >
                        <Undo2 size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteAlertPermanently(a)}
                        title="Excluir permanentemente"
                        className="p-1 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming */}
          <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-black text-slate-800 dark:text-white flex items-center gap-1.5">
              <Clock size={14} className="text-brand-600" /> Próximos Eventos
            </h3>
            <div className="space-y-2">
              {upcoming.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">Nenhum evento futuro.</p>
              ) : (
                upcoming.map(e => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEvent(e)}
                    className="w-full flex items-start gap-2 p-2 rounded-xl border border-slate-100 dark:border-slate-700/50 hover:border-brand-300 dark:hover:border-brand-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-all text-left"
                  >
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${e.color ? '' : TYPE_META[e.type].dot}`} style={e.color ? { backgroundColor: e.color } : undefined} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{e.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-slate-400">
                        <span className="font-mono">{formatDateShort(e.date)}{e.timeStart ? ` ${e.timeStart}` : ''}</span>
                        <span className={`px-1.5 py-0.5 rounded border font-bold ${TYPE_META[e.type].chip}`}>{TYPE_META[e.type].label}</span>
                      </div>
                      {e.responsible && (
                        <p className="text-[9px] text-slate-400 mt-0.5 flex items-center gap-1"><User size={9} /> {e.responsible}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Quick filters */}
          <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-black text-slate-800 dark:text-white flex items-center gap-1.5">
              <ListFilter size={14} className="text-brand-600" /> Filtros Rápidos
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setQuickFilters([])}
                className={`px-2.5 py-1.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  quickFilters.length === 0
                    ? 'bg-slate-900 text-white border-slate-950 dark:bg-brand-600 dark:border-brand-600'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                }`}
              >
                Todos
              </button>
              {ALL_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setQuickFilters(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-semibold border transition-colors ${
                    quickFilters.includes(t)
                      ? 'bg-slate-900 text-white border-slate-950 dark:bg-brand-600 dark:border-brand-600'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${TYPE_META[t].dot}`} />
                  {TYPE_META[t].label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 cursor-pointer group border-t border-slate-100 dark:border-slate-700/50 pt-3">
              <input
                type="checkbox"
                checked={!hideSystem}
                onChange={() => setHideSystem(v => !v)}
                className="w-3.5 h-3.5 rounded accent-brand-600"
              />
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-white transition-colors">
                Eventos do Sistema
              </span>
            </label>
          </div>
        </aside>
      </div>

      {/* FILTERS DRAWER */}
      <FiltersDrawer
        open={filtersOpen}
        onClose={closeFilters}
        onApply={applyFilters}
        onClear={() => setDraft(EMPTY_ADV)}
        title="Filtros do calendário"
      >
        <Input
          label="Pesquisar"
          value={draft.search}
          onChange={e => setDraft({ ...draft, search: e.target.value })}
          placeholder="Título, município, proposta, responsável..."
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Estado (UF)" value={draft.uf} onChange={e => setDraft({ ...draft, uf: e.target.value })}>
            <option value="">Todas</option>
            {ufs.map(u => <option key={u} value={u}>{u}</option>)}
          </Select>
          <Select label="Município" value={draft.municipality} onChange={e => setDraft({ ...draft, municipality: e.target.value })}>
            <option value="">Todos</option>
            {municipalities.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Select label="Status" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select label="Responsável" value={draft.responsible} onChange={e => setDraft({ ...draft, responsible: e.target.value })}>
            <option value="">Todos</option>
            {responsibles.map(r => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Select label="Ano" value={draft.ano} onChange={e => setDraft({ ...draft, ano: e.target.value })}>
            <option value="">Todos</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Select label="Tipo" value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>
            <option value="">Todos</option>
            {eventTypes.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </Select>
          <Select label="Criticidade" value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
            <option value="">Todas</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input type="date" label="Período de" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} />
          <Input type="date" label="Período até" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} />
        </div>
      </FiltersDrawer>

      {/* EVENT FORM MODAL */}
      <EventFormModal
        open={modalOpen}
        initial={editingEvent}
        defaultDate={newEventDate}
        demands={demands}
        onClose={() => { setModalOpen(false); setEditingEvent(null); }}
        onSave={handleSaveEvent}
      />

      {/* EVENT DETAIL DRAWER */}
      {selectedEvent && (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs animate-fade-in" onClick={() => setSelectedEvent(null)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes do evento"
            className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-[#111a2e] shadow-2xl animate-drawer flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700/50 shrink-0">
              <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${selectedEvent.color ? '' : TYPE_META[selectedEvent.type].dot}`} style={selectedEvent.color ? { backgroundColor: selectedEvent.color } : undefined} />
                Detalhes do Evento
              </h3>
              <button
                onClick={() => setSelectedEvent(null)}
                aria-label="Fechar"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Título</p>
                <p className={`text-base font-black text-slate-800 dark:text-white ${selectedEvent.done ? 'line-through opacity-60' : ''}`}>{selectedEvent.title}</p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className={`px-2.5 py-1 rounded-full border text-[10px] font-bold ${TYPE_META[selectedEvent.type].chip}`}>
                  {TYPE_META[selectedEvent.type].label}
                </span>
                {selectedEvent.status && (
                  <StatusBadge status={selectedEvent.status as DemandStatus} className="px-2.5 py-1 rounded-full text-[10px]" />
                )}
                {selectedEvent.priority && (
                  <span className="px-2.5 py-1 rounded-full border text-[10px] font-bold bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/50">
                    {PRIORITY_LABELS[selectedEvent.priority as DemandPriority] || selectedEvent.priority}
                  </span>
                )}
                {selectedEvent.done && (
                  <span className="px-2.5 py-1 rounded-full border text-[10px] font-bold bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50">
                    Concluído
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                  <p className="text-[9px] font-bold uppercase text-slate-400 flex items-center gap-1"><CalendarDays size={10} /> Data</p>
                  <p className="font-black text-slate-800 dark:text-white mt-0.5">{formatDateShort(selectedEvent.date)}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                  <p className="text-[9px] font-bold uppercase text-slate-400 flex items-center gap-1"><Clock size={10} /> Hora</p>
                  <p className="font-black text-slate-800 dark:text-white mt-0.5">
                    {selectedEvent.timeStart || '—'}{selectedEvent.timeEnd ? ` às ${selectedEvent.timeEnd}` : ''}
                  </p>
                </div>
                {selectedEvent.municipality && (
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                    <p className="text-[9px] font-bold uppercase text-slate-400 flex items-center gap-1"><MapPin size={10} /> Município</p>
                    <p className="font-black text-slate-800 dark:text-white mt-0.5 truncate">{selectedEvent.municipality}</p>
                  </div>
                )}
                {selectedEvent.proposalNumber && (
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                    <p className="text-[9px] font-bold uppercase text-slate-400 flex items-center gap-1"><Paperclip size={10} /> Proposta</p>
                    <p className="font-black text-slate-800 dark:text-white mt-0.5 truncate">{selectedEvent.proposalNumber}</p>
                  </div>
                )}
                {selectedEvent.responsible && (
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                    <p className="text-[9px] font-bold uppercase text-slate-400 flex items-center gap-1"><User size={10} /> Responsável</p>
                    <p className="font-black text-slate-800 dark:text-white mt-0.5 truncate">{selectedEvent.responsible}</p>
                  </div>
                )}
                {selectedEvent.demandId && (
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                    <p className="text-[9px] font-bold uppercase text-slate-400 flex items-center gap-1"><FolderKanban size={10} /> Demanda</p>
                    <p className="font-black text-brand-700 dark:text-brand-300 mt-0.5 truncate">{selectedEvent.demandId}</p>
                  </div>
                )}
              </div>

              {selectedEvent.description && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Observações</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 rounded-xl p-3 whitespace-pre-wrap">
                    {selectedEvent.description}
                  </p>
                </div>
              )}

              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1">
                  <Flag size={10} /> Histórico
                </p>
                <div className="space-y-2 mt-1.5">
                  {selectedEvent.source === 'system' && detailTimeline.length === 0 && (
                    <p className="text-[10px] text-slate-400 italic">Evento gerado automaticamente pelo sistema.</p>
                  )}
                  {detailTimeline.length > 0 && detailTimeline.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-700 dark:text-slate-200">{t.title}</p>
                        <p className="text-slate-400 font-mono">{formatDateShort(t.created_at)}</p>
                      </div>
                    </div>
                  ))}
                  {selectedEvent.source === 'user' && (
                    <div className="flex items-start gap-2 text-[10px]">
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-bold text-slate-700 dark:text-slate-200">
                          {selectedEvent.updatedAt ? 'Atualizado em' : 'Criado em'} {formatDateShort(selectedEvent.updatedAt || selectedEvent.createdAt)}
                        </p>
                        <p className="text-slate-400">Evento pessoal (armazenado neste navegador)</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700/50 flex gap-2 shrink-0">
              {selectedEvent.source === 'user' ? (
                <>
                  <button
                    onClick={() => openEdit(selectedEvent)}
                    className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                  >
                    <Pencil size={14} /> Editar
                  </button>
                  <button
                    onClick={() => toggleDone(selectedEvent)}
                    className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors flex items-center gap-1.5"
                  >
                    <Check size={14} /> {selectedEvent.done ? 'Reabrir' : 'Concluir'}
                  </button>
                  <button
                    onClick={() => deleteEvent(selectedEvent)}
                    className="ml-auto px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors flex items-center gap-1.5"
                  >
                    <Trash2 size={14} /> Excluir
                  </button>
                </>
              ) : (
                <p className="text-[10px] text-slate-400 italic">Evento automático do sistema — não pode ser editado.</p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

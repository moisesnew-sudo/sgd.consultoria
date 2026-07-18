import React, { useState, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, FolderKanban, Clock, RefreshCw } from 'lucide-react';
import { demandsApi, formatDateShort } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface CalEvent {
  id: string;
  title: string;
  date: string;
  type: 'demand_created' | 'demand_updated' | 'timeline';
  status: string | null;
  priority?: string;
  demandId?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pendente: 'bg-amber-100 text-amber-700 border-amber-200',
  analise: 'bg-blue-100 text-blue-700 border-blue-200',
  concluido: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejeitado: 'bg-red-100 text-red-700 border-red-200',
};

const TYPE_LABELS: Record<string, string> = {
  demand_created: 'Cadastro',
  demand_updated: 'Atualização',
  timeline: 'Trâmite',
};

const statusBadge = (s: string | null) => {
  if (!s) return 'bg-slate-100 text-slate-600 border-slate-200';
  return STATUS_COLORS[s] || 'bg-slate-100 text-slate-600 border-slate-200';
};

export default function CalendarView() {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(new Date());

  const load = async () => {
    setLoading(true);
    try {
      const data = await demandsApi.getCalendarEvents();
      setEvents(data as CalEvent[]);
    } catch (e) {
      console.error('Calendar load error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const year = current.getFullYear();
  const month = current.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const eventsByDay = useMemo(() => {
    const map: Record<number, CalEvent[]> = {};
    events.forEach((e) => {
      const d = new Date(e.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        (map[day] = map[day] || []).push(e);
      }
    });
    return map;
  }, [events, year, month]);

  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(current);
  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const prev = () => setCurrent(new Date(year, month - 1, 1));
  const next = () => setCurrent(new Date(year, month + 1, 1));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarIcon className="text-blue-600" /> Calendário de Atividades
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Cadastros, atualizações e trâmites por data</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800" title="Atualizar">
            <RefreshCw size={16} />
          </button>
          <button onClick={prev} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            <ChevronLeft size={16} />
          </button>
          <span className="capitalize font-bold text-slate-700 dark:text-slate-200 min-w-[140px] text-center">{monthName}</span>
          <button onClick={next} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-slate-900 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {weekDays.map((w) => (
                <div key={w} className="text-center text-[10px] font-bold uppercase text-slate-400 py-1">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayEvents = eventsByDay[day] || [];
                const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;
                return (
                  <div
                    key={day}
                    className={`min-h-[80px] rounded-lg border p-1.5 text-xs ${
                      isToday ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-100 dark:border-slate-700/50'
                    }`}
                  >
                    <div className={`font-bold ${isToday ? 'text-blue-700' : 'text-slate-500'}`}>{day}</div>
                    <div className="space-y-0.5 mt-1">
                      {dayEvents.slice(0, 3).map((e) => (
                        <div key={e.id} className={`truncate rounded px-1 py-0.5 text-[9px] font-semibold border ${statusBadge(e.status)}`} title={e.title}>
                          {e.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[9px] text-slate-400 font-medium">+{dayEvents.length - 3} mais</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
              <Clock size={14} /> Próximos Eventos
            </h3>
            <div className="space-y-2 max-h-[480px] overflow-y-auto">
              {events
                .slice()
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, 30)
                .map((e) => (
                  <div key={e.id} className="flex gap-2 items-start border-b border-slate-100 dark:border-slate-700/40 pb-2">
                    <FolderKanban size={14} className="text-slate-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{e.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-slate-400">{formatDateShort(e.date)}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${statusBadge(e.status)}`}>
                          {TYPE_LABELS[e.type] || e.type}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              {events.length === 0 && (
                <p className="text-[11px] text-slate-400 italic">Nenhum evento registrado.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

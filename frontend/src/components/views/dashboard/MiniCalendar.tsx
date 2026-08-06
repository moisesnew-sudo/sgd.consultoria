import { useMemo, memo } from 'react';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { Card } from '../../ui/Card';
import { DashboardCalEvent, dateKey } from './types';

interface Props {
  events: DashboardCalEvent[];
  onNavigateToTab: (tab: string) => void;
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const TYPE_DOT: Record<string, string> = {
  prazo: 'bg-amber-400',
  reuniao: 'bg-purple-400',
  atualizacao: 'bg-emerald-400',
  demanda: 'bg-blue-400',
  outros: 'bg-slate-400',
};

function MiniCalendar({ events, onNavigateToTab }: Props) {
  const month = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const m = now.getMonth();
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const startOffset = new Date(year, m, 1).getDay();
    const today = now.getDate();

    const eventDates = new Set(
      events
        .filter(e => e.date.startsWith(`${year}-${String(m + 1).padStart(2, '0')}`))
        .map(e => Number(e.date.slice(8, 10)))
    );
    const dotFor = (day: number): string => {
      const matches = events.filter(e => e.date === `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      if (matches.length === 0) return '';
      const type = matches[0].type;
      return TYPE_DOT[type] || TYPE_DOT.outros;
    };

    const upcoming = events
      .filter(e => e.date >= dateKey(now))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3);

    return { year, m, daysInMonth, startOffset, today, eventDates, dotFor, upcoming };
  }, [events]);

  const cells: (number | null)[] = [
    ...Array.from({ length: month.startOffset }, () => null),
    ...Array.from({ length: month.daysInMonth }, (_, i) => i + 1),
  ];

  const monthLabel = new Date(month.year, month.m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <Card
      title="Calendário do Mês"
      subtitle={monthLabel}
      icon={<CalendarDays size={18} />}
      action={
        <button onClick={() => onNavigateToTab('calendar')} className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1">
          Abrir <ChevronRight size={14} />
        </button>
      }
    >
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="text-center text-[10px] font-bold text-slate-400 uppercase">{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) =>
          day === null ? (
            <span key={`e-${i}`} />
          ) : (
            <button
              key={day}
              onClick={() => onNavigateToTab('calendar')}
              className={`relative aspect-square rounded-lg flex items-center justify-center text-[11px] font-semibold transition-all cursor-pointer ${
                day === month.today
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {day}
              {day !== month.today && month.eventDates.has(day) && (
                <span className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${month.dotFor(day)}`} />
              )}
            </button>
          )
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
        {month.upcoming.length === 0 ? (
          <p className="text-[11px] text-slate-400 text-center py-1">Nenhum evento agendado.</p>
        ) : (
          month.upcoming.map(e => (
            <button
              key={e.id}
              onClick={() => onNavigateToTab('calendar')}
              className="w-full flex items-center gap-2 text-left group cursor-pointer"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_DOT[e.type] || TYPE_DOT.outros}`} />
              <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
                {e.title}
              </span>
              <span className="text-[10px] text-slate-400 shrink-0">
                {new Date(e.date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </span>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

export default memo(MiniCalendar);

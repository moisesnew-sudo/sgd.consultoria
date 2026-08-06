import React, { useMemo, memo } from 'react';
import { BellRing, AlertTriangle, Hourglass, AlertCircle, CalendarDays, CheckCircle2, ChevronRight } from 'lucide-react';
import { Demand } from '../../../types';
import { Card } from '../../ui/Card';
import { DashboardCalEvent, SLA_DAYS, dateKey } from './types';

interface Props {
  demands: Demand[];
  events: DashboardCalEvent[];
  onNavigateToTab: (tab: string) => void;
}

interface AlertItem {
  id: string;
  title: string;
  sub: string;
  icon: React.ReactNode;
  iconCls: string;
  tab: string;
}

function AlertsPanel({ demands, events, onNavigateToTab }: Props) {
  const alerts = useMemo<AlertItem[]>(() => {
    const open = demands.filter(d => d.status === 'pendente' || d.status === 'analise');
    const age = (d: Demand) => (Date.now() - new Date(d.created_at).getTime()) / 86400000;
    const overdue = open.filter(d => age(d) > (SLA_DAYS[d.priority] || 30));
    const dueSoon = open.filter(d => {
      const rem = (SLA_DAYS[d.priority] || 30) - age(d);
      return rem >= 0 && rem <= 7;
    });
    const urgentOpen = open.filter(d => d.priority === 'urgente');

    const todayKey = dateKey(new Date());
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = dateKey(tomorrow);
    const todayEvents = events.filter(e => e.date === todayKey).length;
    const tomorrowEvents = events.filter(e => e.date === tomorrowKey).length;

    const list: AlertItem[] = [];
    if (overdue.length > 0) {
      list.push({
        id: 'overdue',
        title: `${overdue.length} ${overdue.length === 1 ? 'demanda vencida' : 'demandas vencidas'}`,
        sub: 'Prazo de SLA ultrapassado',
        icon: <AlertTriangle size={16} />,
        iconCls: 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300',
        tab: 'demands',
      });
    }
    if (urgentOpen.length > 0) {
      list.push({
        id: 'urgent',
        title: `${urgentOpen.length} ${urgentOpen.length === 1 ? 'demanda urgente' : 'demandas urgentes'} aguardando`,
        sub: 'Prioridade máxima em análise',
        icon: <AlertCircle size={16} />,
        iconCls: 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300',
        tab: 'demands',
      });
    }
    if (dueSoon.length > 0) {
      list.push({
        id: 'due-soon',
        title: `${dueSoon.length} ${dueSoon.length === 1 ? 'demanda vence' : 'demandas vencem'} em 7 dias`,
        sub: 'Fique atento ao prazo de SLA',
        icon: <Hourglass size={16} />,
        iconCls: 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
        tab: 'demands',
      });
    }
    if (todayEvents > 0) {
      list.push({
        id: 'today-events',
        title: `${todayEvents} ${todayEvents === 1 ? 'compromisso hoje' : 'compromissos hoje'}`,
        sub: 'Agenda do dia no calendário',
        icon: <CalendarDays size={16} />,
        iconCls: 'bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300',
        tab: 'calendar',
      });
    }
    if (tomorrowEvents > 0) {
      list.push({
        id: 'tomorrow-events',
        title: `${tomorrowEvents} ${tomorrowEvents === 1 ? 'compromisso amanhã' : 'compromissos amanhã'}`,
        sub: 'Próximos eventos agendados',
        icon: <CalendarDays size={16} />,
        iconCls: 'bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300',
        tab: 'calendar',
      });
    }
    return list.slice(0, 6);
  }, [demands, events]);

  return (
    <Card title="Alertas" subtitle="Atenção necessária" icon={<BellRing size={18} />}>
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <CheckCircle2 size={28} className="text-emerald-500" />
          <p className="text-xs text-slate-400">Nenhum alerta pendente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(a => (
            <button
              key={a.id}
              onClick={() => onNavigateToTab(a.tab)}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50/40 dark:hover:bg-brand-900/10 transition-all text-left cursor-pointer group"
            >
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${a.iconCls}`}>{a.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors truncate">
                  {a.title}
                </span>
                <span className="block text-[10px] text-slate-400 truncate">{a.sub}</span>
              </span>
              <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export default memo(AlertsPanel);

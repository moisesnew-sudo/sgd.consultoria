import { useMemo, memo } from 'react';
import { Hourglass, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Demand } from '../../../types';
import { Card } from '../../ui/Card';
import { PriorityBadge } from '../../ui/StatusBadge';
import { SLA_DAYS } from './types';

interface Props {
  demands: Demand[];
  onSelectDemand: (demand: Demand) => void;
  onNavigateToTab: (tab: string) => void;
}

function DeadlinesCard({ demands, onSelectDemand, onNavigateToTab }: Props) {
  const items = useMemo(() => {
    const open = demands.filter(d => d.status === 'pendente' || d.status === 'analise');
    return open
      .map(d => {
        const age = (Date.now() - new Date(d.created_at).getTime()) / 86400000;
        const sla = SLA_DAYS[d.priority] || 30;
        return { d, remaining: sla - age, sla };
      })
      .filter(x => x.remaining >= 0)
      .sort((a, b) => a.remaining - b.remaining)
      .slice(0, 5);
  }, [demands]);

  const daysLabel = (remaining: number) => {
    const days = Math.ceil(remaining);
    if (days <= 0) return 'vence hoje';
    if (days === 1) return 'vence amanhã';
    return `em ${days} dias`;
  };

  const daysCls = (remaining: number) => {
    if (remaining <= 2) return 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300';
    if (remaining <= 7) return 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300';
    return 'text-slate-500 bg-slate-50 dark:bg-slate-800/60 dark:text-slate-400';
  };

  return (
    <Card
      title="Próximos Vencimentos"
      subtitle="Prazo de SLA estimado"
      icon={<Hourglass size={18} />}
      action={
        <button onClick={() => onNavigateToTab('demands')} className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1">
          Ver demandas <ArrowRight size={14} />
        </button>
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <CheckCircle2 size={28} className="text-emerald-500" />
          <p className="text-xs text-slate-400">Nenhum vencimento próximo. Tudo em dia!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(({ d, remaining, sla }) => {
            const consumed = Math.min(100, Math.max(2, ((sla - remaining) / sla) * 100));
            return (
              <button
                key={d.id}
                onClick={() => onSelectDemand(d)}
                className="w-full text-left group p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50/40 dark:hover:bg-brand-900/10 transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
                    {d.title}
                  </span>
                  <PriorityBadge priority={d.priority} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400 truncate">{d.municipality}/{d.uf}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${daysCls(remaining)}`}>
                    {daysLabel(remaining)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mt-1.5">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${remaining <= 2 ? 'bg-rose-500' : remaining <= 7 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                    style={{ width: `${consumed}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default memo(DeadlinesCard);

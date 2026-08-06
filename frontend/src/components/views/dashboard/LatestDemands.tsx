import { useMemo, memo } from 'react';
import { ListOrdered, ArrowRight, Inbox } from 'lucide-react';
import { Demand } from '../../../types';
import { formatCurrency } from '../../../services/api';
import { Card } from '../../ui/Card';
import { StatusBadge, PriorityBadge } from '../../ui/StatusBadge';

interface Props {
  demands: Demand[];
  onSelectDemand: (demand: Demand) => void;
  onNavigateToTab: (tab: string) => void;
}

function LatestDemands({ demands, onSelectDemand, onNavigateToTab }: Props) {
  const latest = useMemo(
    () =>
      [...demands]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 6),
    [demands]
  );

  return (
    <Card
      title="Últimas Demandas"
      subtitle="Cadastradas mais recentemente"
      icon={<ListOrdered size={18} />}
      className="lg:col-span-2"
      action={
        <button onClick={() => onNavigateToTab('demands')} className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1">
          Ver todas <ArrowRight size={14} />
        </button>
      }
    >
      {latest.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Inbox size={28} className="text-slate-300 dark:text-slate-600" />
          <p className="text-xs text-slate-400">Nenhuma demanda cadastrada ainda.</p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2 px-2">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <span>Demanda</span>
              <span>Status</span>
              <span>Município</span>
              <span className="text-right">Valor</span>
            </div>
            <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
              {latest.map(d => (
                <button
                  key={d.id}
                  onClick={() => onSelectDemand(d)}
                  className="w-full grid grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3 items-center px-3 py-2.5 text-left hover:bg-brand-50/40 dark:hover:bg-brand-900/10 transition-colors cursor-pointer rounded-lg"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{d.title}</span>
                    <span className="block text-[10px] text-slate-400 mt-0.5">
                      {d.id} · {new Date(d.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <StatusBadge status={d.status} />
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{d.municipality}/{d.uf}</span>
                  <span className="flex flex-col items-end min-w-0">
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{formatCurrency(d.requested_value || 0)}</span>
                    <PriorityBadge priority={d.priority} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default memo(LatestDemands);

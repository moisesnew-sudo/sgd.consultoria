import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Demand } from '../../../types';
import { formatCurrency } from '../../../services/api';
import { Card } from '../../ui/Card';

interface Props {
  current: Demand[];
  previous: Demand[];
  currentYear: number;
  previousYear: number;
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const byMonth = (list: Demand[]): number[] => {
  const m = Array.from({ length: 12 }, () => 0);
  for (const d of list) {
    const t = new Date(d.created_at).getTime();
    if (!isNaN(t)) m[new Date(t).getMonth()]++;
  }
  return m;
};

const sumValue = (list: Demand[]): number => list.reduce((s, d) => s + (d.requested_value || 0), 0);
const countConcluded = (list: Demand[]): number => list.filter(d => d.status === 'concluido').length;

function DeltaStat({ label, cur, prev, fmt }: { label: string; cur: number; prev: number; fmt: (n: number) => string }) {
  const delta = cur - prev;
  const pct = prev > 0 ? (delta / prev) * 100 : 0;
  const icon = delta > 0 ? <TrendingUp size={13} className="text-emerald-600" /> : delta < 0 ? <TrendingDown size={13} className="text-rose-600" /> : <Minus size={13} className="text-slate-400" />;
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">{label}</p>
      <p className="text-lg font-black text-slate-900 dark:text-white truncate">{fmt(cur)}</p>
      <p className="flex items-center gap-1 text-[10px] font-semibold">
        {icon}
        <span className={delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-slate-400'}>
          {delta >= 0 ? '+' : ''}{delta.toFixed(0)} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
        </span>
        <span className="text-slate-400 font-normal">vs {fmt(prev)}</span>
      </p>
    </div>
  );
}

export default function ComparisonCard({ current, previous, currentYear, previousYear }: Props) {
  const chartData = useMemo(() => {
    const cur = byMonth(current);
    const prev = byMonth(previous);
    return MONTHS.map((name, i) => ({ name, 'Este ano': cur[i], 'Ano anterior': prev[i] }));
  }, [current, previous]);

  const deltas = useMemo(() => ({
    created: { cur: current.length, prev: previous.length },
    value: { cur: sumValue(current), prev: sumValue(previous) },
    concluded: { cur: countConcluded(current), prev: countConcluded(previous) },
  }), [current, previous]);

  return (
    <Card
      title="Estatísticas Comparativas"
      subtitle={`${currentYear} vs ${previousYear}`}
      icon={<ArrowUpRight size={18} />}
      className="lg:col-span-2"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4 px-1">
          <DeltaStat label="Demandas criadas" cur={deltas.created.cur} prev={deltas.created.prev} fmt={n => String(n)} />
          <DeltaStat label="Valor solicitado" cur={deltas.value.cur} prev={deltas.value.prev} fmt={formatCurrency} />
          <DeltaStat label="Concluídas" cur={deltas.concluded.cur} prev={deltas.concluded.prev} fmt={n => String(n)} />
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:[stroke:#1e293b]" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} interval={1} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} width={34} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, background: 'rgba(255,255,255,0.95)' }}
              cursor={{ fill: 'rgba(46,125,50,0.06)' }}
            />
            <Bar dataKey="Ano anterior" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={14} />
            <Bar dataKey="Este ano" fill="#2E7D32" radius={[4, 4, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

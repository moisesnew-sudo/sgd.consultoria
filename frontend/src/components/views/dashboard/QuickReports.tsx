import React, { memo } from 'react';
import { BarChart3, ScrollText, Activity, Database, Plug, Shield, ChevronRight, FileBarChart2 } from 'lucide-react';
import { Card } from '../../ui/Card';

interface Props {
  onNavigateToTab: (tab: string) => void;
}

interface ReportItem {
  tab: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  cls: string;
}

function QuickReports({ onNavigateToTab }: Props) {
  const items: ReportItem[] = [
    {
      tab: 'reports',
      label: 'Relatórios e Análises',
      desc: 'KPIs, rankings e gráficos consolidados',
      icon: <BarChart3 size={16} />,
      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    },
    {
      tab: 'audit',
      label: 'Trilha de Auditoria',
      desc: 'Histórico de ações no sistema',
      icon: <ScrollText size={16} />,
      cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
    },
    {
      tab: 'monitoring',
      label: 'Monitoramento',
      desc: 'Saúde de servidor, API e banco',
      icon: <Activity size={16} />,
      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    },
    {
      tab: 'backup',
      label: 'Backup e Restauração',
      desc: 'Cópias de segurança do sistema',
      icon: <Database size={16} />,
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    },
    {
      tab: 'integrations',
      label: 'Integrações',
      desc: 'API pública e endpoints',
      icon: <Plug size={16} />,
      cls: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
    },
    {
      tab: 'lgpd',
      label: 'Conformidade LGPD',
      desc: 'Privacidade e dados pessoais',
      icon: <Shield size={16} />,
      cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
  ];

  return (
    <Card title="Relatórios Rápidos" subtitle="Acessos diretos" icon={<FileBarChart2 size={18} />}>
      <div className="space-y-1.5">
        {items.map(it => (
          <button
            key={it.tab}
            onClick={() => onNavigateToTab(it.tab)}
            className="w-full flex items-center gap-3 p-2 rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all text-left cursor-pointer group"
          >
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${it.cls}`}>{it.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors truncate">
                {it.label}
              </span>
              <span className="block text-[10px] text-slate-400 truncate">{it.desc}</span>
            </span>
            <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
          </button>
        ))}
      </div>
    </Card>
  );
}

export default memo(QuickReports);

import React from 'react';
import { Plus, CalendarDays, BarChart3, MapPin, Users, Activity, ScrollText, Database, Zap } from 'lucide-react';
import { Card } from '../../ui/Card';

interface Props {
  onNavigateToTab: (tab: string) => void;
  canCreate: boolean;
}

interface ActionItem {
  tab: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  cls: string;
}

export default function QuickActions({ onNavigateToTab, canCreate }: Props) {
  const items: ActionItem[] = [
    ...(canCreate ? [{
      tab: 'new-demand',
      label: 'Nova Demanda',
      desc: 'Cadastrar solicitação',
      icon: <Plus size={18} />,
      cls: 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
    }] : []),
    {
      tab: 'calendar',
      label: 'Calendário',
      desc: 'Eventos e prazos',
      icon: <CalendarDays size={18} />,
      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    },
    {
      tab: 'reports',
      label: 'Relatórios',
      desc: 'Análises e exportações',
      icon: <BarChart3 size={18} />,
      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    },
    {
      tab: 'municipalities',
      label: 'Municípios',
      desc: 'Cadastro municipal',
      icon: <MapPin size={18} />,
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    },
    {
      tab: 'users',
      label: 'Usuários',
      desc: 'Acessos e permissões',
      icon: <Users size={18} />,
      cls: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
    },
    {
      tab: 'monitoring',
      label: 'Monitoramento',
      desc: 'Saúde do sistema',
      icon: <Activity size={18} />,
      cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
    },
    {
      tab: 'audit',
      label: 'Auditoria',
      desc: 'Trilha de eventos',
      icon: <ScrollText size={18} />,
      cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
    {
      tab: 'backup',
      label: 'Backup',
      desc: 'Cópias de segurança',
      icon: <Database size={18} />,
      cls: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
    },
  ];

  return (
    <Card title="Ações Rápidas" subtitle="Atalhos de uso frequente" icon={<Zap size={18} />}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.map((it) => (
          <button
            key={it.tab}
            onClick={() => onNavigateToTab(it.tab)}
            className="group flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-900/20 transition-all text-left cursor-pointer"
          >
            <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${it.cls}`}>{it.icon}</span>
            <span className="min-w-0">
              <span className="block text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors truncate">
                {it.label}
              </span>
              <span className="block text-[10px] text-slate-400 truncate">{it.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

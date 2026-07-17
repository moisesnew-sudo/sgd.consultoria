import React, { useEffect, useState } from 'react';
import { 
  Calendar, 
  Hourglass, 
  CheckCircle2, 
  RotateCw, 
  AlertTriangle, 
  TrendingUp, 
  DollarSign, 
  MapPin, 
  Users, 
  Clock, 
  ArrowRight, 
  AlertCircle
} from 'lucide-react';
import { Demand, DashboardStats } from '../types';
import { demandsApi, formatCurrency, formatDate } from '../services/api';

interface DashboardViewProps {
  onNavigateToTab: (tab: string) => void;
  onSelectDemand: (demand: Demand) => void;
}

export default function DashboardView({ onNavigateToTab, onSelectDemand }: DashboardViewProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentDemands, setRecentDemands] = useState<Demand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      const [statsData, demandsData] = await Promise.all([
        demandsApi.getDashboardStats(),
        demandsApi.getAll({ limit: 5, page: 1 })
      ]);
      setStats(statsData);
      setRecentDemands(demandsData.data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados do dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-slate-900 border-t-indigo-500 rounded-full animate-spin"></div>
          <p className="text-xs font-semibold text-slate-500 font-mono">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle size={48} className="text-red-500" />
          <h3 className="text-lg font-bold text-slate-800">Erro ao carregar dashboard</h3>
          <p className="text-sm text-slate-500">{error}</p>
          <button 
            onClick={loadDashboardData}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // Calculate metrics
  const totalGeral = stats.total;
  const abertasCount = stats.byStatus['triagem'] || 0;
  const concluidasCount = stats.byStatus['concluido'] || 0;
  const emAndamentoCount = (stats.byStatus['em_andamento'] || 0) + (stats.byStatus['analise_tecnica'] || 0);
  const overdueCount = stats.overdue;
  const completedPercent = totalGeral > 0 ? Math.round((concluidasCount / totalGeral) * 100) : 0;

  // Get latest events across all demands
  const allEvents = recentDemands.flatMap(d => 
    (d.timeline || []).map(e => ({
      ...e,
      demandId: d.id,
      demandTitle: d.title,
    }))
  );
  const latestEvents = allEvents
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-8" id="dashboard-view-root">
      {/* Welcome Banner */}
      <div className="bg-slate-900 text-white p-6 md:p-8 rounded-2xl relative overflow-hidden shadow-xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-tr from-indigo-500/10 to-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="space-y-2 relative z-10">
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
            Painel Geral de Controle
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            Seja bem vindo!
          </h2>
          <p className="text-slate-300 text-sm max-w-xl leading-relaxed">
            Bem-vindo ao <strong>SGD - Sistema de Gestão de Demandas</strong>. Hoje é dia <strong>{new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>. 
            Controle integrado de processos de consultoria e acompanhamento de propostas.
          </p>
        </div>
        <div className="flex gap-3 relative z-10">
          <button
            onClick={() => onNavigateToTab('new-demand')}
            className="px-4 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-500 text-[#001f4d] font-bold text-xs uppercase tracking-wider shadow-md hover:shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-yellow-300"
          >
            Nova Demanda
          </button>
          <button
            onClick={() => onNavigateToTab('demands')}
            className="px-4 py-2.5 rounded-xl bg-blue-800 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all border border-blue-700/50"
          >
            Ver Todas
          </button>
        </div>
      </div>

      {/* Core Metrics Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4" id="core-metrics">
        {/* Card 1: Demandas Hoje */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Calendar size={20} />
            </div>
            {stats.todayCount > 0 ? (
              <span className="text-[10px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <TrendingUp size={10} /> +{stats.todayCount}
              </span>
            ) : (
              <span className="text-[10px] text-slate-400">Estável</span>
            )}
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Demandas Hoje</h3>
            <p className="text-2xl font-black text-slate-900 mt-1">{stats.todayCount}</p>
            <p className="text-[10px] text-slate-400 mt-1">Registradas hoje</p>
          </div>
        </div>

        {/* Card 2: Demandas Abertas */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
              <Hourglass size={20} />
            </div>
            <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">Triagem</span>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Demandas Abertas</h3>
            <p className="text-2xl font-black text-slate-900 mt-1">{abertasCount}</p>
            <p className="text-[10px] text-slate-400 mt-1">Aguardando validação inicial</p>
          </div>
        </div>

        {/* Card 3: Em Andamento */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <RotateCw className="animate-spin-slow" size={20} />
            </div>
            <span className="text-[10px] bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded-full">Análise / Execução</span>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Em Andamento</h3>
            <p className="text-2xl font-black text-slate-900 mt-1">{emAndamentoCount}</p>
            <p className="text-[10px] text-slate-400 mt-1">Em avaliação de engenharia</p>
          </div>
        </div>

        {/* Card 4: Finalizadas */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-green-50 text-green-600">
              <CheckCircle2 size={20} />
            </div>
            <span className="text-[10px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded-full">Concluídas</span>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Finalizadas</h3>
            <p className="text-2xl font-black text-slate-900 mt-1">{concluidasCount}</p>
            <p className="text-[10px] text-green-600 mt-1 font-semibold">{completedPercent}% do total</p>
          </div>
        </div>

        {/* Card 5: Atrasadas */}
        <div className={`border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between ${
          overdueCount > 0 
            ? 'bg-rose-50/50 border-rose-200 text-rose-950 animate-pulse-slow' 
            : 'bg-white border-slate-100 text-slate-900'
        }`}>
          <div className="flex justify-between items-start">
            <div className={`p-2 rounded-lg ${overdueCount > 0 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
              <AlertTriangle size={20} />
            </div>
            {overdueCount > 0 && (
              <span className="text-[10px] bg-rose-200 text-rose-800 font-bold px-2 py-0.5 rounded-full">Atenção</span>
            )}
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Atrasadas</h3>
            <p className="text-2xl font-black mt-1">{overdueCount}</p>
            <p className="text-[10px] text-rose-700/80 mt-1">SLA técnico estourado</p>
          </div>
        </div>

        {/* Card 6: Total Geral */}
        <div className="bg-gradient-to-tr from-slate-900 to-indigo-950 text-white rounded-2xl p-4 shadow-md hover:shadow-lg transition-all flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="p-2 rounded-lg bg-white/10 text-indigo-400">
              <DollarSign size={20} />
            </div>
            <span className="text-[10px] bg-indigo-500 text-white font-bold px-2 py-0.5 rounded-full">Total</span>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Total Geral</h3>
            <p className="text-2xl font-black text-white mt-1">{totalGeral}</p>
            <p className="text-[10px] text-slate-300 mt-1">Mapeadas no painel</p>
          </div>
        </div>
      </section>

      {/* Financial Summary */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50/50 border border-slate-100 p-5 rounded-2xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-700 shadow-xs">
            <DollarSign size={22} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Volume Financeiro Total</p>
            <h4 className="text-lg font-extrabold text-slate-900 mt-0.5">{formatCurrency(stats.totalValue)}</h4>
            <p className="text-[10px] text-slate-400">Total das propostas cadastradas</p>
          </div>
        </div>

        <div className="flex items-center gap-4 border-t md:border-t-0 md:border-x border-slate-200/60 md:px-6 pt-4 md:pt-0">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-700 shadow-xs">
            <MapPin size={22} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Municípios Atendidos</p>
            <h4 className="text-lg font-extrabold text-slate-900 mt-0.5">{stats.byUf.length} estados</h4>
            <p className="text-[10px] text-slate-400">Distribuídos nacionalmente</p>
          </div>
        </div>

        <div className="flex items-center gap-4 border-t md:border-t-0 md:pt-0 pt-4">
          <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-700 shadow-xs">
            <AlertTriangle size={22} />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Demandas Atrasadas</p>
            <h4 className="text-lg font-extrabold text-slate-900 mt-0.5">{overdueCount} demandas</h4>
            <p className="text-[10px] text-rose-600 font-semibold">Requer atenção imediata</p>
          </div>
        </div>
      </section>

      {/* Recent Activities */}
      <section className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-md font-bold text-slate-900 flex items-center gap-2">
              <Clock size={18} className="text-[#001f4d]" />
              Atividade Recente
            </h3>
            <p className="text-xs text-slate-500">Últimas atualizações realizadas nas demandas</p>
          </div>
          <button
            onClick={() => onNavigateToTab('demands')}
            className="text-xs font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1 hover:underline"
          >
            Ver todas <ArrowRight size={14} />
          </button>
        </div>

        {latestEvents.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Nenhuma atividade recente encontrada.
          </div>
        ) : (
          <div className="relative border-l-2 border-slate-100 ml-3 pl-6 space-y-6">
            {latestEvents.map((evt) => (
              <div key={evt.id} className="relative group">
                <span className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 border-white bg-[#001f4d] shadow-sm group-hover:scale-110 transition-transform" />
                
                <div className="space-y-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                    <span className="font-bold text-slate-800 group-hover:text-blue-800 transition-colors">
                      {evt.title}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono bg-slate-50 px-2 py-0.5 rounded">
                      {formatDate(evt.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    Demanda: <strong className="text-slate-700">{evt.demandId}</strong> | {evt.demandTitle}
                  </p>
                  <p className="text-xs text-slate-600 bg-slate-50/50 p-2.5 rounded-lg border border-slate-100">
                    {evt.description}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                    <span>Por: <strong>{evt.user_name}</strong></span>
                    {evt.status_changed_to && (
                      <>
                        <span>•</span>
                        <span className="text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded font-semibold uppercase">
                          Status: {evt.status_changed_to}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
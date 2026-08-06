import { useState, useEffect, useCallback } from 'react';
import { LogOut, Monitor, Globe, Smartphone, Laptop, Clock, ShieldX, RefreshCw, AlertCircle } from 'lucide-react';
import { sessionsApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { Skeleton } from '../ui/Skeleton';
import { PageHeader } from '../ui/PageHeader';
import { EmptyState } from '../ui/EmptyState';

export default function SessionsView() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setSessions(await sessionsApi.list()); }
    catch (e: any) { setError(e?.message || 'Não foi possível carregar as sessões ativas.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTerminate = async (id: number) => {
    try {
      await sessionsApi.terminate(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (e: any) {
      setError(e?.message || 'Não foi possível encerrar a sessão.');
    }
  };

  const getOsIcon = (os: string) => {
    switch (os?.toLowerCase()) {
      case 'windows': return <Monitor size={16} />;
      case 'macos': return <Laptop size={16} />;
      case 'linux': return <Monitor size={16} />;
      case 'android': return <Smartphone size={16} />;
      case 'ios': return <Smartphone size={16} />;
      default: return <Globe size={16} />;
    }
  };

  const getSessionStatus = (session: any) => {
    const inactive = !session.active || session.status === 'Inativa';
    return inactive
      ? { label: 'Inativa', class: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
      : { label: 'Ativa', class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sessões Ativas"
        subtitle="Gerencie as sessões ativas do sistema"
        icon={<ShieldX className="text-brand-600" />}
        actions={
          <button onClick={load} aria-label="Atualizar sessões" className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer" title="Atualizar">
            <RefreshCw size={16} />
          </button>
        }
      />

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 rounded-xl text-xs font-semibold flex items-center gap-2" role="alert">
          <AlertCircle size={16} /> {error}
          <button onClick={load} className="ml-auto text-[11px] font-bold underline hover:text-rose-700 dark:hover:text-rose-200">Tentar novamente</button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4">
              <Skeleton className="h-16" />
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <EmptyState
            icon={<LogOut size={40} />}
            title="Nenhuma sessão ativa no momento."
            className="py-10"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(session => {
            const status = getSessionStatus(session);
            return (
              <div key={session.id} className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 mt-0.5">
                      {getOsIcon(session.os)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-white">{session.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold text-white"
                          style={{ backgroundColor: session.role === 'admin' ? '#dc2626' : session.role === 'gestor' ? '#2563eb' : '#64748b' }}>
                          {session.role}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${status.class}`}>{status.label}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1"><Globe size={12} /> {session.ip_address || 'N/A'}</span>
                        <span className="flex items-center gap-1">{session.os || 'Desconhecido'}</span>
                        <span className="flex items-center gap-1"><Monitor size={12} /> {session.browser || 'Desconhecido'}</span>
                        <span className="flex items-center gap-1"><Clock size={12} /> Última atividade: {new Date(session.last_activity).toLocaleString('pt-BR')}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">Iniciada em: {new Date(session.started_at).toLocaleString('pt-BR')}</p>
                    </div>
                  </div>
                  {session.active && (
                    <button onClick={() => handleTerminate(session.id)}
                      className="shrink-0 p-2 rounded-lg border border-red-200 hover:bg-red-50 text-red-500 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors"
                      title="Encerrar sessão"
                      aria-label={`Encerrar sessão de ${session.name}`}>
                      <LogOut size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

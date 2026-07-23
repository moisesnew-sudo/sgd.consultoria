import { useCallback } from 'react';
import {
  LayoutDashboard, FilePlus2, FolderKanban, MapPin, FileBarChart,
  Calendar, Settings, Menu, X, Users, ScrollText, Plug, Database,
  Briefcase, ShieldCheck, LogOut, User, Sun, Moon, MonitorSmartphone
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme, ThemeMode } from '../contexts/ThemeContext';
import { ROLE_LABELS } from '../services/api';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  pendingCount: number;
}

export default function Sidebar({ activeTab, setActiveTab, isOpen, setIsOpen, pendingCount }: SidebarProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  const themeOptions: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'light', icon: <Sun size={14} />, label: 'Claro' },
    { mode: 'dark', icon: <Moon size={14} />, label: 'Escuro' },
    { mode: 'system', icon: <MonitorSmartphone size={14} />, label: 'Auto' },
  ];

  const canCreate = user?.role === 'admin' || user?.role === 'gestor' || user?.role === 'analista';
  const canManageUsers = user?.role === 'admin';
  const canSettings = user?.role === 'admin';

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: null },
    ...(isAuthenticated && canCreate ? [
      { id: 'new-demand', label: 'Nova Demanda', icon: FilePlus2, badge: null }
    ] : []),
    { id: 'demands', label: 'Demandas', icon: FolderKanban, badge: pendingCount > 0 ? pendingCount : null },
    { id: 'calendar', label: 'Calendário', icon: Calendar, badge: null },
    { id: 'reports', label: 'Relatórios', icon: FileBarChart, badge: null },
    ...(isAuthenticated && canManageUsers ? [
      { id: 'users', label: 'Usuários', icon: Users, badge: null },
      { id: 'backup', label: 'Backup', icon: Database, badge: null }
    ] : []),
    ...(isAuthenticated && canSettings ? [
      { id: 'settings', label: 'Configurações', icon: Settings, badge: null }
    ] : [])
  ];

  const handleLogout = useCallback(() => {
    logout();
    setActiveTab('demands');
    setIsOpen(false);
  }, [logout, setActiveTab, setIsOpen]);

  const handleNav = useCallback((id: string) => {
    setActiveTab(id);
    setIsOpen(false);
  }, [setActiveTab, setIsOpen]);

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-gov-green text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 hover:bg-gov-green-dark transition-colors"
        aria-label={isOpen ? 'Fechar menu' : 'Abrir menu'}
      >
        {isOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-gov-green text-slate-100 flex flex-col shadow-2xl transition-transform duration-300 ease-out transform lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-5 border-b border-slate-800/80 shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 mt-0.5 bg-gradient-to-br from-brand-500 to-brand-700 rounded-xl flex items-center justify-center shadow-lg border border-white/10 shrink-0">
              <Briefcase className="text-white" size={22} />
            </div>
            <div>
              <h1 className="text-[18px] lg:text-[20px] font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-brand-200 leading-tight">
                CGASI.SE
              </h1>
              <p
                className="text-[12px] lg:text-[13px] font-medium leading-[1.4] text-slate-300 mt-1"
                title="COORDENAÇÃO GERAL DE ARTICULAÇÃO E SUPERVISÃO INSTITUCIONAL DA SECRETARIA EXECUTIVA / MAPA"
              >
                COORDENAÇÃO GERAL DE ARTICULAÇÃO E SUPERVISÃO INSTITUCIONAL DA SECRETARIA EXECUTIVA / MAPA
              </p>
            </div>
          </div>
          {isAuthenticated && user && (
            <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center text-[11px] font-bold text-brand-200 shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-semibold text-slate-100">{user.name}</p>
                <span className={`inline-block px-1.5 py-0.5 text-[7px] font-bold rounded mt-0.5 uppercase tracking-wider ${
                  user.role === 'admin' ? 'bg-brand-500/20 text-brand-300' :
                  user.role === 'gestor' ? 'bg-blue-500/20 text-blue-300' :
                  user.role === 'analista' ? 'bg-emerald-500/20 text-emerald-300' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {ROLE_LABELS[user.role]}
                </span>
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-0.5" aria-label="Navegação principal">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group focus:outline-none focus:ring-2 focus:ring-yellow-400/60 ${
                  isActive
                    ? 'bg-gradient-to-r from-brand-700/90 to-brand-800/80 text-white shadow-sm border-l-[3px] border-yellow-400'
                    : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    size={19}
                    className={`shrink-0 ${isActive ? 'text-yellow-400' : 'text-slate-400 group-hover:text-slate-200'}`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== null && (
                  <span className="shrink-0 bg-yellow-400 text-blue-950 font-bold text-[10px] px-2 py-0.5 rounded-full animate-pulse shadow-sm ml-2">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-3 shrink-0">
          <div className="flex items-center justify-between gap-1 bg-slate-800/60 border border-slate-700/60 rounded-xl p-1">
            {themeOptions.map((opt) => (
              <button
                key={opt.mode}
                onClick={() => setTheme(opt.mode)}
                title={`Tema ${opt.label}`}
                aria-label={`Tema ${opt.label}`}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[9px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-yellow-400/60 ${
                  theme === opt.mode
                    ? 'bg-yellow-400 text-blue-950 shadow-sm'
                    : 'text-slate-400 hover:bg-slate-700/60 hover:text-white'
                }`}
              >
                {opt.icon}
                <span className="hidden sm:inline">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {isAuthenticated && user && (
          <div className="px-3 pb-4 shrink-0">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-700/60 text-slate-400 hover:text-red-400 hover:border-red-800/40 hover:bg-red-950/20 text-[11px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-red-400/60 cursor-pointer"
            >
              <LogOut size={14} />
              Sair do Sistema
            </button>
          </div>
        )}

        {!isAuthenticated && (
          <div className="px-3 pb-4 shrink-0">
            <button
              onClick={() => handleNav('login')}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white text-[11px] font-bold transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-yellow-400/60 cursor-pointer"
            >
              <ShieldCheck size={14} />
              Acessar o Sistema
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

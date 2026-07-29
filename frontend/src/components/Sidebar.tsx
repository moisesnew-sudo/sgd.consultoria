import { useCallback } from 'react';
import {
  LayoutDashboard, FilePlus2, FolderKanban, MapPin, FileBarChart,
  Calendar, Settings, Menu, X, Users, ScrollText, Plug, Database,
  Briefcase, ShieldCheck, LogOut, User, Sun, Moon, MonitorSmartphone,
  Activity, Shield, LogIn, HardDrive, FileSearch
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme, ThemeMode } from '../contexts/ThemeContext';
import { ROLE_LABELS } from '../services/api';
import { LogoFull } from './ui/Logo';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  pendingCount: number;
}

export default function Sidebar({ activeTab, setActiveTab, isOpen, setIsOpen, pendingCount }: SidebarProps) {
  const { user, isAuthenticated, logout, hasPermission } = useAuth();
  const { theme, setTheme } = useTheme();

  const themeOptions: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'light', icon: <Sun size={14} />, label: 'Claro' },
    { mode: 'dark', icon: <Moon size={14} />, label: 'Escuro' },
    { mode: 'system', icon: <MonitorSmartphone size={14} />, label: 'Auto' },
  ];

  const canCreate = hasPermission('demands.create');
  const canManageUsers = hasPermission('users.view');
  const canViewSettings = hasPermission('settings.view');

  const menuItems = [
    ...(isAuthenticated && hasPermission('dashboard.view') ? [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: null }
    ] : []),
    ...(isAuthenticated && canCreate ? [
      { id: 'new-demand', label: 'Nova Demanda', icon: FilePlus2, badge: null }
    ] : []),
    ...(isAuthenticated && hasPermission('demands.view') ? [
      { id: 'demands', label: 'Demandas', icon: FolderKanban, badge: pendingCount > 0 ? pendingCount : null }
    ] : []),
    ...(isAuthenticated && hasPermission('demands.view') ? [
      { id: 'calendar', label: 'Calendário', icon: Calendar, badge: null }
    ] : []),
    ...(isAuthenticated && hasPermission('reports.view') ? [
      { id: 'reports', label: 'Relatórios', icon: FileBarChart, badge: null }
    ] : []),
    ...(isAuthenticated && canManageUsers ? [
      { id: 'users', label: 'Usuários', icon: Users, badge: null },
    ] : []),
    ...(isAuthenticated && hasPermission('settings.view') ? [
      { id: 'settings', label: 'Configurações', icon: Settings, badge: null }
    ] : []),
    ...(isAuthenticated && canManageUsers ? [
      { id: 'backup', label: 'Backups', icon: HardDrive, badge: null }
    ] : []),
    ...(isAuthenticated && (user?.role === 'admin' || user?.role === 'administrador') ? [
      { id: 'audit-dashboard', label: 'Auditoria', icon: Activity, badge: null },
      { id: 'audit', label: 'Logs', icon: ScrollText, badge: null },
      { id: 'sessions', label: 'Sessões', icon: LogIn, badge: null },
      { id: 'monitoring', label: 'Monitoramento', icon: Shield, badge: null },
      { id: 'lgpd', label: 'LGPD', icon: FileSearch, badge: null },
    ] : []),
  ];

  const handleLogout = useCallback(async () => {
    await logout();
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
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-gov-700 text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-gold hover:bg-gov-800 transition-colors"
        aria-label={isOpen ? 'Fechar menu' : 'Abrir menu'}
      >
        {isOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-gov-900 dark:bg-[#0a1628] text-slate-100 flex flex-col shadow-2xl transition-transform duration-300 ease-out transform lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-white/5 shrink-0">
          <LogoFull />
          {isAuthenticated && user && (
            <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gov-500 to-gov-800 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-lg">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-100 truncate">{user.name}</p>
                <span className={`inline-block px-1.5 py-0.5 text-[7px] font-bold rounded mt-0.5 uppercase tracking-wider ${
                  user.role === 'admin' || user.role === 'administrador' ? 'bg-gov-700/30 text-gov-300' :
                  user.role === 'gestor' || user.role === 'diretor' ? 'bg-blue-500/20 text-blue-300' :
                  'bg-amber-500/20 text-amber-300'
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
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group focus:outline-none focus:ring-2 focus:ring-gold/60 ${
                  isActive
                    ? 'bg-gov-700/40 text-white shadow-sm border-l-[3px] border-gold'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    size={19}
                    className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== null && (
                  <span className="shrink-0 bg-gold text-gov-900 font-bold text-[10px] px-2 py-0.5 rounded-full animate-pulse shadow-sm ml-2">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-3 shrink-0">
          <div className="flex items-center justify-between gap-1 bg-black/20 border border-white/5 rounded-xl p-1">
            {themeOptions.map((opt) => (
              <button
                key={opt.mode}
                onClick={() => setTheme(opt.mode)}
                title={`Tema ${opt.label}`}
                aria-label={`Tema ${opt.label}`}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[9px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-gold/60 ${
                  theme === opt.mode
                    ? 'bg-gold text-gov-900 shadow-sm'
                    : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
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
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/5 text-slate-500 hover:text-red-400 hover:border-red-800/40 hover:bg-red-950/20 text-[11px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-red-400/60 cursor-pointer"
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
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gov-700 hover:bg-gov-800 text-white text-[11px] font-bold transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-gold/60 cursor-pointer"
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

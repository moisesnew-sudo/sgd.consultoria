import { useCallback, useEffect, useState } from 'react';
import { Menu, X, Sun, Moon, MonitorSmartphone, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme, ThemeMode } from '../../contexts/ThemeContext';
import { ROLE_LABELS } from '../../services/api';
import { LogoSymbol } from './Logo';

interface HeaderProps {
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  pendingCount: number;
}

export function Header({ onToggleSidebar, isSidebarOpen, pendingCount }: HeaderProps) {
  const { user, logout, isAuthenticated } = useAuth();
  const { theme, setTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!showUserMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-user-menu]')) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showUserMenu]);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]);
  }, [theme, setTheme]);

  const themeIcon = {
    light: <Sun size={16} />,
    dark: <Moon size={16} />,
    system: <MonitorSmartphone size={16} />,
  }[theme];

  const themeLabel = {
    light: 'Claro',
    dark: 'Escuro',
    system: 'Auto',
  }[theme];

  return (
    <header
      className={`sticky top-0 z-30 w-full transition-all duration-300 ${
        scrolled
          ? 'bg-white/80 dark:bg-[#0a1628]/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-700/30 shadow-[0_1px_0_rgba(0,0,0,0.02)]'
          : 'bg-transparent'
      }`}
    >
      <div className="flex items-center justify-between h-16 px-4 md:px-6">
        {/* Left side */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="lg:hidden p-2 -ml-2 rounded-lg text-slate-500 hover:text-gov-700 dark:hover:text-gov-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            aria-label={isSidebarOpen ? 'Fechar menu' : 'Abrir menu'}
          >
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center gap-2.5 animate-fade-in-up">
            <LogoSymbol size={32} />
            <div className="hidden sm:block">
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-extrabold tracking-tight text-gov-900 dark:text-white leading-none">
                  CGASI
                </span>
                <span className="text-sm font-bold tracking-tight text-gov-500 dark:text-gold leading-none">
                  .SE
                </span>
              </div>
              <p className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 tracking-tight leading-tight -mt-0.5">
                Coordenação Geral de Articulação e Supervisão Institucional
              </p>
            </div>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Pending badge */}
          {pendingCount > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-400 text-[11px] font-bold animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              {pendingCount} pendente{pendingCount !== 1 ? 's' : ''}
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            title={`Tema: ${themeLabel}`}
            aria-label={`Alternar tema (${themeLabel})`}
          >
            {themeIcon}
          </button>

          {/* User menu */}
          {isAuthenticated && user && (
            <div className="relative" data-user-menu>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-all group"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gov-600 to-gov-800 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 leading-tight">{user.name}</p>
                  <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 leading-tight">{ROLE_LABELS[user.role]}</p>
                </div>
                <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-[#0f1f3a] border border-slate-200 dark:border-slate-700/50 rounded-xl shadow-elevated py-1.5 animate-scale-in origin-top-right">
                  <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-700/50">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{user.name}</p>
                    <span className={`inline-block mt-0.5 px-1.5 py-0.5 text-[8px] font-bold rounded uppercase tracking-wider ${
                      user.role === 'admin' || user.role === 'administrador' ? 'bg-gov-100 dark:bg-gov-900/40 text-gov-800 dark:text-gov-300' :
                      user.role === 'gestor' || user.role === 'diretor' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                      'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                    }`}>
                      {ROLE_LABELS[user.role]}
                    </span>
                  </div>
                  <button
                    onClick={() => { logout(); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <LogOut size={14} />
                    Sair do Sistema
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;

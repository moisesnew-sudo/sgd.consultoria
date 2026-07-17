import React from 'react';
import { 
  LayoutDashboard, 
  FilePlus2, 
  FolderKanban, 
  MapPin, 
  FileBarChart, 
  Settings, 
  Menu, 
  X,
  Briefcase,
  ShieldCheck,
  LogOut,
  User
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  pendingCount: number;
}

export default function Sidebar({ activeTab, setActiveTab, isOpen, setIsOpen, pendingCount }: SidebarProps) {
  const { user, isAuthenticated, logout } = useAuth();

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: null },
    ...(isAuthenticated && user?.role !== 'viewer' ? [
      { id: 'new-demand', label: 'Nova Demanda', icon: FilePlus2, badge: null }
    ] : []),
    { id: 'demands', label: 'Demandas', icon: FolderKanban, badge: pendingCount > 0 ? pendingCount : null },
    { id: 'municipalities', label: 'Municípios', icon: MapPin, badge: null },
    { id: 'reports', label: 'Relatórios', icon: FileBarChart, badge: null },
    ...(isAuthenticated && user?.role === 'admin' ? [
      { id: 'settings', label: 'Configurações', icon: Settings, badge: null }
    ] : [])
  ];

  const handleLogout = () => {
    logout();
    setActiveTab('demands');
    setIsOpen(false);
  };

  return (
    <>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-[#002f6c] text-white shadow-md focus:outline-none focus:ring-2 focus:ring-yellow-400"
        aria-label="Toggle Menu"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Backdrop for Mobile */}
      {isOpen && (
        <div 
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#001f4d] text-slate-100 flex flex-col justify-between shadow-2xl transition-transform duration-300 transform lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Logo Section */}
          <div className="p-6 border-b border-slate-800/80 flex flex-col items-center">
            <div className="flex items-center gap-3">
              <div className="relative w-12 h-12 bg-gradient-to-tr from-indigo-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg border border-white/10">
                <Briefcase className="text-white" size={24} />
              </div>
              <div>
                <h1 className="text-sm font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-blue-300">
                  SGD
                </h1>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Gestão Particular
                </p>
              </div>
            </div>
            <div className="mt-4 text-center">
              <span className="text-xs font-bold text-slate-200 block truncate max-w-[200px]">
                Gestão de Demandas
              </span>
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono mt-1 inline-block">
                v2.0-Produção
              </span>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="p-4 space-y-1.5" aria-label="Main Navigation">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all group focus:outline-none focus:ring-2 focus:ring-yellow-400 ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-700 to-blue-800 text-white shadow-md border-l-4 border-yellow-400'
                      : 'text-slate-300 hover:bg-slate-800/40 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon 
                      size={20} 
                      className={`transition-colors ${
                        isActive ? 'text-yellow-400' : 'text-slate-400 group-hover:text-slate-200'
                      }`} 
                    />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== null && (
                    <span className="bg-yellow-400 text-blue-950 font-bold text-xs px-2 py-0.5 rounded-full animate-pulse shadow-sm">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Profile Section */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
          {isAuthenticated && user ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-indigo-800 border border-indigo-400/30 flex items-center justify-center font-bold text-sm text-indigo-300 shadow-md">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-100 truncate">
                    {user.name}
                  </p>
                  <p className="text-[10px] text-indigo-400 font-mono truncate">
                    {user.email}
                  </p>
                  <span className={`inline-block px-1.5 py-0.5 text-[8px] font-bold rounded mt-0.5 uppercase tracking-wider ${
                    user.role === 'admin' 
                      ? 'bg-emerald-500/10 text-emerald-300' 
                      : user.role === 'user' 
                      ? 'bg-blue-500/10 text-blue-300' 
                      : 'bg-yellow-500/10 text-yellow-400'
                  }`}>
                    {user.role === 'admin' ? 'Administrador' : user.role === 'user' ? 'Usuário' : 'Visualizador'}
                  </span>
                </div>
              </div>
              <div className="mt-2 pt-2 text-[9px] text-slate-400 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Sessão Autenticada
                </div>
                <button
                  onClick={handleLogout}
                  className="text-[10px] text-red-400 hover:text-red-300 font-bold hover:underline cursor-pointer flex items-center gap-1"
                >
                  <LogOut size={10} />
                  Sair
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-slate-400 shadow-sm">
                  <User size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-100 truncate">
                    Modo Visitante
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    Apenas Visualização
                  </p>
                  <span className="inline-block px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 text-[8px] font-bold rounded mt-0.5 uppercase tracking-wider">
                    Acesso Público
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  setActiveTab('login');
                  setIsOpen(false);
                }}
                className="w-full py-2 px-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white rounded-xl text-xs font-bold transition-all shadow-md text-center cursor-pointer uppercase tracking-wider"
              >
                Login
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
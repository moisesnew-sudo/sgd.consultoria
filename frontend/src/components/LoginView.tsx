import React, { useState } from 'react';
import { Briefcase, Lock, User, Eye, EyeOff, ShieldCheck, ArrowRight, AlertCircle, Sun, Moon, MonitorSmartphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme, ThemeMode } from '../contexts/ThemeContext';

interface LoginViewProps {
  onNavigateToTab: (tab: string) => void;
}

export default function LoginView({ onNavigateToTab }: LoginViewProps) {
  const { login, isAuthenticated } = useAuth();
  const { theme, setTheme } = useTheme();

  const themeCycle: ThemeMode[] = ['light', 'dark', 'system'];
  const themeMeta: Record<ThemeMode, { icon: React.ReactNode; label: string }> = {
    light: { icon: <Sun size={16} />, label: 'Claro' },
    dark: { icon: <Moon size={16} />, label: 'Escuro' },
    system: { icon: <MonitorSmartphone size={16} />, label: 'Automático' },
  };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      onNavigateToTab('demands');
    }
  }, [isAuthenticated, onNavigateToTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail) {
      setError('Por favor, informe seu e-mail.');
      return;
    }
    if (!cleanPassword) {
      setError('Por favor, digite sua senha de acesso.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await login(cleanEmail, cleanPassword);
      onNavigateToTab('demands');
    } catch (err: any) {
      setError(err.message || 'Credenciais inválidas. Usuário ou senha incorretos.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b1120] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden font-sans transition-colors">
      {/* Top corporate accent border */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-indigo-600 z-50" />

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => {
          const idx = themeCycle.indexOf(theme);
          setTheme(themeCycle[(idx + 1) % themeCycle.length]);
        }}
        className="fixed top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#111a2e] border border-slate-200 dark:border-slate-700 shadow-sm text-slate-600 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors"
        aria-label={`Tema ${themeMeta[theme].label}`}
        title={`Tema: ${themeMeta[theme].label} (clique para alternar)`}
      >
        {themeMeta[theme].icon}
        <span className="text-xs font-bold">{themeMeta[theme].label}</span>
      </button>

      {/* Decorative subtle background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[400px] h-[400px] bg-indigo-50 dark:bg-indigo-950/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-slate-100 dark:bg-slate-800/30 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex flex-col items-center">
          {/* Corporate Logo Badge */}
          <div className="relative w-16 h-16 bg-gradient-to-tr from-slate-900 to-indigo-950 dark:from-slate-800 dark:to-indigo-900 rounded-2xl flex items-center justify-center shadow-xl border border-slate-800/40">
            <Briefcase className="text-indigo-400" size={28} />
          </div>

          <h1 className="mt-6 text-center text-2xl font-black text-slate-900 dark:text-white uppercase tracking-wider">
            CGASI.SE
          </h1>
          <p className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">
            COORDENAÇÃO GERAL DE ARTICULAÇÃO E SUPERVISÃO INSTITUCIONAL DA SECRETÁRIA EXECUTIVA/ MAPA
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-[10px] text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">
            <ShieldCheck size={12} className="text-slate-500 dark:text-slate-400" />
            Gestão de Demandas
          </div>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-white dark:bg-[#111a2e] py-8 px-6 shadow-2xl border border-slate-100/80 dark:border-slate-700/50 rounded-3xl sm:px-10 space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-black text-slate-800 dark:text-white">
              Identificação do Consultor
            </h2>
            <p className="text-xs text-slate-400 dark:text-slate-400">
              Entre com suas credenciais para acessar o painel de demandas.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 rounded-xl text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1">
              <label htmlFor="email" className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                E-mail *
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <User size={16} />
                </span>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.gov.br"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label htmlFor="password" className="text-xs font-bold text-slate-700 dark:text-slate-200 block">
                  Senha de Acesso *
                </label>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock size={16} />
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha de acesso"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  aria-label={showPassword ? "Ocultar senha" : "Exibir senha"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center pt-1">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                defaultChecked
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded-sm"
              />
              <label htmlFor="remember-me" className="ml-2 block text-xs font-semibold text-slate-600 cursor-pointer">
                Manter conectado neste terminal
              </label>
            </div>

            {/* Submission Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-slate-900 to-indigo-950 text-white font-bold text-xs uppercase tracking-wider hover:opacity-95 shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Autenticando...</span>
                  </>
                ) : (
                  <>
                    <span>Entrar no Sistema</span>
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </form>

        </div>
        
        {/* Footer info */}
        <div className="text-center mt-6 text-[10px] text-slate-400 font-mono">
          © CGASI.SE • {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
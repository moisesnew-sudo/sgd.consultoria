import React, { useState } from 'react';
import { Lock, User, Eye, EyeOff, ShieldCheck, ArrowRight, AlertCircle, Sun, Moon, MonitorSmartphone, Contrast, Accessibility } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme, ThemeMode } from '../../contexts/ThemeContext';
import { LogoSymbol } from '../ui/Logo';
import { Spinner } from '../ui/Spinner';
import { Input } from '../ui/Fields';
import appPackage from '../../../package.json';

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
  const [highContrast, setHighContrast] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    if (isAuthenticated) onNavigateToTab('dashboard');
  }, [isAuthenticated, onNavigateToTab]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      onNavigateToTab('dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Credenciais inválidas. Usuário ou senha incorretos.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className={`min-h-[100dvh] relative isolate grid grid-rows-[auto_1fr_auto] overflow-hidden bg-gov-900 font-sans ${highContrast ? 'login-high-contrast' : ''}`}>
      <div className="absolute inset-0 -z-20 bg-[url('/images/agro.jpg')] bg-cover bg-center" aria-hidden="true" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#062719]/90 via-[#0b3927]/76 to-[#061b15]/88 backdrop-blur-sm" aria-hidden="true" />
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gov-700 via-gold to-gov-500" aria-hidden="true" />

      <header className="relative z-10 flex justify-end p-3 sm:p-5">
        <div className="flex items-center gap-2 rounded-2xl border border-white/30 bg-white/15 p-1.5 text-white shadow-lg backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setHighContrast((current) => !current)}
            aria-pressed={highContrast}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold transition hover:bg-white/20 active:scale-95"
            title="Alternar alto contraste"
          >
            <Contrast size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Alto contraste</span>
            <span className="sr-only sm:hidden">Alto contraste</span>
          </button>
          <span className="h-5 w-px bg-white/25" aria-hidden="true" />
          <button
            type="button"
            onClick={() => {
              const index = themeCycle.indexOf(theme);
              setTheme(themeCycle[(index + 1) % themeCycle.length]);
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold transition hover:bg-white/20 active:scale-95"
            aria-label={`Tema atual: ${themeMeta[theme].label}. Clique para alternar.`}
            title={`Tema: ${themeMeta[theme].label}`}
          >
            {themeMeta[theme].icon}
            <span className="hidden sm:inline">{themeMeta[theme].label}</span>
          </button>
        </div>
      </header>

      <section className="relative z-10 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center text-center text-white animate-fade-in-up">
            <LogoSymbol size={72} />
            <div className="mt-4 flex flex-col items-center">
              <div className="flex items-baseline gap-1.5">
                <h1 className="text-2xl font-extrabold tracking-tight text-white drop-shadow-sm">CGASI</h1>
                <span className="text-2xl font-bold tracking-tight text-gold">.SE</span>
              </div>
              <p className="mt-1 text-[11px] font-semibold tracking-wide leading-tight text-white/85">COORDENAÇÃO GERAL DE</p>
              <p className="text-[11px] font-semibold tracking-wide leading-tight text-white/85">ARTICULAÇÃO E SUPERVISÃO</p>
              <p className="text-[11px] font-semibold tracking-wide leading-tight text-white/85">INSTITUCIONAL DA SECRETARIA EXECUTIVA</p>
              <p className="mt-1 text-xs font-extrabold tracking-wider text-gold">MAPA</p>
            </div>
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm backdrop-blur-md">
              <ShieldCheck size={10} aria-hidden="true" /> Gestão de Demandas
            </div>
          </div>

          <div className="mt-6 space-y-6 rounded-3xl border border-white/30 bg-white/20 px-6 py-7 text-white shadow-2xl backdrop-blur-xl sm:mt-8 sm:px-10 sm:py-8 animate-fade-in-up">
            <div className="space-y-1">
              <div className="mb-2 flex items-center gap-2 text-gold"><Accessibility size={17} aria-hidden="true" /><span className="text-[10px] font-extrabold uppercase tracking-[0.16em]">Área restrita</span></div>
              <h2 className="text-lg font-extrabold text-white">Identificação do Consultor</h2>
              <p className="text-xs leading-relaxed text-white/75">Entre com suas credenciais para acessar o painel de demandas.</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200/70 bg-red-950/55 p-3 text-xs font-semibold text-red-100" role="alert">
                <AlertCircle size={16} aria-hidden="true" /> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="block text-xs font-bold text-white">E-mail <span className="text-gold" aria-hidden="true">*</span><span className="sr-only"> obrigatório</span></label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="seu@email.gov.br" icon={<User size={16} />} className="border-white/35 bg-white/90 text-slate-900 shadow-sm placeholder:text-slate-500 focus:ring-gold" />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="password" className="block text-xs font-bold text-white">Senha de acesso <span className="text-gold" aria-hidden="true">*</span><span className="sr-only"> obrigatório</span></label>
                  <button type="button" onClick={() => onNavigateToTab('reset-password')} className="text-[11px] font-bold text-gold underline decoration-gold/60 underline-offset-2 transition hover:text-white">Esqueci minha senha</button>
                </div>
                <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha de acesso" icon={<Lock size={16} />} className="border-white/35 bg-white/90 text-slate-900 shadow-sm placeholder:text-slate-500 focus:ring-gold" iconRight={<button type="button" onClick={() => setShowPassword((visible) => !visible)} className="cursor-pointer rounded text-slate-500 transition hover:text-gov-900" aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>} />
              </div>

              <div className="pt-2">
                <button type="submit" disabled={isLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gov-700 px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-gov-800 hover:shadow-xl active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60">
                  {isLoading ? <><Spinner size={16} className="text-white" /><span>Autenticando...</span></> : <><span>Entrar no Sistema</span><ArrowRight size={14} aria-hidden="true" /></>}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <footer className="relative z-10 px-4 pb-5 text-center text-[10px] text-white/75 sm:pb-7">
        <div className="mx-auto flex max-w-md flex-wrap justify-center gap-x-3 gap-y-1">
          <a href="https://www.gov.br/pt-br/termos-de-uso" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">Termos e privacidade</a>
          <span aria-hidden="true">•</span>
          <button type="button" onClick={() => setHighContrast((current) => !current)} className="underline underline-offset-2 hover:text-white">Acessibilidade</button>
          <span aria-hidden="true">•</span>
          <span>© CGASI.SE {new Date().getFullYear()} · v{appPackage.version}</span>
        </div>
      </footer>
    </main>
  );
}

import React, { useState } from 'react';
import { KeyRound, ArrowLeft, CheckCircle, AlertCircle, Loader2, Eye, EyeOff, Mail } from 'lucide-react';
import { passwordResetApi } from '../../services/api';
import { Input } from '../ui/Fields';

export default function ResetPasswordView({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<'email' | 'token'>('email');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');
  React.useEffect(() => {
    if (urlToken) { setToken(urlToken); setStep('token'); }
  }, [urlToken]);

  const handleRequestReset = async () => {
    setLoading(true); setError(''); setMessage('');
    try {
      const res = await passwordResetApi.request(email);
      setMessage(res.message);
    } catch (e: any) {
      setError(e.message || 'Erro ao solicitar redefinição');
    } finally { setLoading(false); }
  };

  const handleReset = async () => {
    if (password !== confirmPassword) { setError('Senhas não conferem'); return; }
    if (password.length < 8) { setError('Senha deve ter pelo menos 8 caracteres'); return; }
    setLoading(true); setError(''); setMessage('');
    try {
      const res = await passwordResetApi.reset(token, password);
      setMessage(res.message);
    } catch (e: any) {
      setError(e.message || 'Erro ao redefinir senha');
    } finally { setLoading(false); }
  };

  if (message && step === 'token') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 dark:from-slate-950 dark:to-emerald-950 p-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8 max-w-md w-full text-center">
          <CheckCircle className="mx-auto text-emerald-500 mb-4" size={48} />
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Senha redefinida!</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-6">{message}</p>
          <button onClick={onBack} className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors">
            Fazer Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 dark:from-slate-950 dark:to-emerald-950 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8 max-w-md w-full">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-6">
          <ArrowLeft size={16} /> Voltar
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-brand-100 dark:bg-brand-900/30">
            <KeyRound className="text-brand-600" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Redefinir Senha</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{step === 'email' ? 'Informe seu email' : 'Crie uma nova senha'}</p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400" role="alert">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {message && step === 'email' && (
          <div className="flex items-start gap-2 p-3 mb-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle size={16} className="mt-0.5 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {step === 'email' ? (
          <div className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.gov.br"
              icon={<Mail size={16} />}
            />
            <button onClick={handleRequestReset} disabled={loading || !email}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : null}
              Solicitar Redefinição
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label="Nova Senha"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mín. 8 caracteres, maiúscula, minúscula, número, especial"
              iconRight={
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer" aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />
            <Input
              label="Confirmar Senha"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repita a nova senha"
            />
            <button onClick={handleReset} disabled={loading || !password || !confirmPassword}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
              {loading ? <Loader2 className="animate-spin" size={18} /> : null}
              Redefinir Senha
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

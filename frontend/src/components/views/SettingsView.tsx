import { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, Shield, Download, Save, Loader2, Key, Eye, EyeOff, LogOut
} from 'lucide-react';
import { settingsApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { PageHeader } from '../ui/PageHeader';
import { Input } from '../ui/Fields';

interface SettingsViewProps {
  onBackToLogin: () => void;
}

interface AppSettings {
  organization_name: string;
  primary_color: string;
  accent_color: string;
  logo_url: string;
}

export default function SettingsView({ onBackToLogin }: SettingsViewProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [settings, setSettings] = useState<AppSettings>({
    organization_name: 'CGASI.SE - Coordenação Geral de Articulação e Supervisão Institucional da Secretaria Executiva/ MAPA',
    primary_color: '#2E7D32',
    accent_color: '#2563eb',
    logo_url: ''
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [message]);

  const loadSettings = async () => {
    try {
      const data = await settingsApi.get();
      if (data) {
        setSettings({
          organization_name: data.organization_name || settings.organization_name,
          primary_color: data.primary_color || settings.primary_color,
          accent_color: data.accent_color || settings.accent_color,
          logo_url: data.logo_url || settings.logo_url
        });
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setMessage('');
    try {
      await settingsApi.update(settings);
      setMessage('Configurações salvas com sucesso!');
    } catch (err: any) {
      setMessage('Erro ao salvar: ' + (err.message || 'Tente novamente'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage('Preencha todos os campos de senha.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('As senhas não coincidem.');
      return;
    }
    if (newPassword.length < 8) {
      setMessage('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }

    setIsChangingPassword(true);
    setMessage('');
    try {
      await settingsApi.changePassword({ current_password: currentPassword, new_password: newPassword });
      setMessage('Senha alterada com sucesso!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setMessage('Erro ao alterar senha: ' + (err.message || 'Verifique a senha atual'));
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleExportData = async () => {
    try {
      const data = await settingsApi.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sgd_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast('error', 'Erro ao exportar', err?.message || 'Tente novamente');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Configurações do Sistema"
        subtitle="Gerencie parâmetros gerais, segurança e dados do sistema."
        icon={<SettingsIcon className="text-brand-700" size={26} />}
      />

      {message && (
        <div className={`p-3 rounded-xl text-sm font-semibold ${
          message.includes('sucesso') || message.includes('Sucesso')
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`} role={message.includes('sucesso') || message.includes('Sucesso') ? 'status' : 'alert'}>
          {message}
        </div>
      )}

      {/* General Settings */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-3xl p-6 shadow-sm space-y-5">
        <h3 className="text-xs font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest flex items-center gap-2">
          <SettingsIcon size={16} /> Aparência
        </h3>

        <Input
          label="Nome da Organização"
          type="text"
          value={settings.organization_name}
          onChange={(e) => setSettings({ ...settings, organization_name: e.target.value })}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Cor Primária</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={settings.primary_color}
                onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                aria-label="Cor Primária"
              />
              <input
                type="text"
                value={settings.primary_color}
                onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
                aria-label="Valor hexadecimal da cor primária"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Cor de Destaque</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={settings.accent_color}
                onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })}
                className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                aria-label="Cor de Destaque"
              />
              <input
                type="text"
                value={settings.accent_color}
                onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
                aria-label="Valor hexadecimal da cor de destaque"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white font-bold text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar Aparência
        </button>
      </div>

      {/* Password */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-3xl p-6 shadow-sm space-y-5">
        <h3 className="text-xs font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest flex items-center gap-2">
          <Shield size={16} /> Segurança
        </h3>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Usuário logado: <strong className="text-slate-900 dark:text-white">{user?.name}</strong> ({user?.email})
          </p>
          <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">Perfil: {user?.role === 'admin' ? 'Administrador' : user?.role === 'gestor' ? 'Gestor' : user?.role === 'analista' ? 'Analista' : 'Consulta'}</p>
        </div>

        <div className="space-y-3">
          <Input
            label="Senha Atual"
            required
            type={showCurrentPassword ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            iconRight={
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                aria-label={showCurrentPassword ? 'Ocultar senha' : 'Exibir senha'}
              >
                {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />

          <Input
            label="Nova Senha"
            required
            type={showNewPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            iconRight={
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                aria-label={showNewPassword ? 'Ocultar senha' : 'Exibir senha'}
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />

          <Input
            label="Confirmar Nova Senha"
            required
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            iconRight={
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                aria-label={showConfirmPassword ? 'Ocultar senha' : 'Exibir senha'}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />

          <button
            onClick={handleChangePassword}
            disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 transition-colors"
          >
            {isChangingPassword ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
            Alterar Senha
          </button>
        </div>
      </div>

      {/* Data Management */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-3xl p-6 shadow-sm space-y-5">
        <h3 className="text-xs font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest flex items-center gap-2">
          <Download size={16} /> Dados
        </h3>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleExportData}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider cursor-pointer transition-colors"
          >
            <Download size={14} /> Exportar Backup (JSON)
          </button>
        </div>

        <p className="text-[10px] text-slate-400">
          A exportação inclui todas as demandas, municípios e configurações do sistema.
        </p>
      </div>

      {/* Session */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="text-xs font-extrabold text-brand-700 dark:text-brand-400 uppercase tracking-widest flex items-center gap-2">
          <LogOut size={16} /> Sessão
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Ao sair, você precisará inserir suas credenciais novamente para acessar o sistema.
        </p>
        <button
          onClick={onBackToLogin}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider cursor-pointer transition-colors"
        >
          <LogOut size={14} /> Sair e Voltar ao Login
        </button>
      </div>
    </div>
  );
}
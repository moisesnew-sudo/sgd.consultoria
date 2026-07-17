import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, Shield, Upload, Download, Save, Loader2, Key, Eye, EyeOff
} from 'lucide-react';
import { settingsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

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
  
  const [settings, setSettings] = useState<AppSettings>({
    organization_name: 'Sistema de Gestão de Demandas',
    primary_color: '#001f4d',
    accent_color: '#2563eb',
    logo_url: ''
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

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
      setTimeout(() => setMessage(''), 3000);
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
      setTimeout(() => setMessage(''), 3000);
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
      alert('Erro ao exportar: ' + (err.message || 'Tente novamente'));
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
          <SettingsIcon className="text-indigo-950" size={26} />
          Configurações do Sistema
        </h2>
        <p className="text-sm text-slate-500">
          Gerencie parâmetros gerais, segurança e dados do sistema.
        </p>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-sm font-semibold ${
          message.includes('sucesso') || message.includes('Sucesso')
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      {/* General Settings */}
      <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-5">
        <h3 className="text-xs font-extrabold text-indigo-950 uppercase tracking-widest flex items-center gap-2">
          <SettingsIcon size={16} /> Aparência
        </h3>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 block">Nome da Organização</label>
          <input
            type="text"
            value={settings.organization_name}
            onChange={(e) => setSettings({ ...settings, organization_name: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">Cor Primária</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={settings.primary_color}
                onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                value={settings.primary_color}
                onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">Cor de Destaque</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={settings.accent_color}
                onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })}
                className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                value={settings.accent_color}
                onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-indigo-950 text-white font-bold text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Salvar Aparência
        </button>
      </div>

      {/* Password */}
      <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-5">
        <h3 className="text-xs font-extrabold text-indigo-950 uppercase tracking-widest flex items-center gap-2">
          <Shield size={16} /> Segurança
        </h3>

        <div className="bg-slate-50 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-600">
            Usuário logado: <strong className="text-slate-900">{user?.name}</strong> ({user?.email})
          </p>
          <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">Perfil: {user?.role === 'admin' ? 'Administrador' : 'Consulta'}</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">Senha Atual *</label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">Nova Senha *</label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="w-full px-4 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 block">Confirmar Nova Senha *</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
            />
          </div>

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
      <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-5">
        <h3 className="text-xs font-extrabold text-indigo-950 uppercase tracking-widest flex items-center gap-2">
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

      {/* Danger Zone */}
      <div className="bg-red-50/50 border border-red-200 rounded-3xl p-6 space-y-4">
        <h3 className="text-xs font-extrabold text-red-600 uppercase tracking-widest flex items-center gap-2">
          <Shield size={16} /> Zona de Perigo
        </h3>
        <p className="text-xs text-red-600/80">
          Ao sair, você precisará inserir suas credenciais novamente para acessar o sistema.
        </p>
        <button
          onClick={onBackToLogin}
          className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider cursor-pointer transition-colors"
        >
          Sair e Voltar ao Login
        </button>
      </div>
    </div>
  );
}
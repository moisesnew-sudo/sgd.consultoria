import { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, AlertTriangle } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input, Textarea, Select } from '../../ui/Fields';
import { integrationAdminApi } from '../../../services/api';
import { useToast } from '../../../contexts/ToastContext';
import { maskConfigForDisplay, unmaskConfigForSubmit } from '../../../lib/integrationConfig';
import type { IntegrationSystem, IntegrationSystemCreateData, IntegrationSystemUpdateData, IntegrationAdapter } from '../../../types';

interface IntegrationSystemFormProps {
  open: boolean;
  onClose: () => void;
  system?: IntegrationSystem | null;
  adapters: IntegrationAdapter[];
  onSuccess: () => void;
}

export default function IntegrationSystemForm({ open, onClose, system, adapters, onSuccess }: IntegrationSystemFormProps) {
  const { toast } = useToast();
  const isEditing = !!system;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    secret_env_key: '',
    config: '',
    active: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (system) {
        setForm({
          code: system.code,
          name: system.name,
          description: system.description || '',
          secret_env_key: '', // Never pre-fill secret
          config: system.config ? JSON.stringify(maskConfigForDisplay(system.config), null, 2) : '',
          active: system.active,
        });
      } else {
        setForm({
          code: '',
          name: '',
          description: '',
          secret_env_key: '',
          config: '',
          active: true,
        });
      }
      setErrors({});
    }
  }, [open, system]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.code.trim()) newErrors.code = 'Código é obrigatório';
    else if (!/^[a-z0-9_-]+$/.test(form.code)) newErrors.code = 'Código deve conter apenas letras minúsculas, números, _ e -';
    if (!form.name.trim()) newErrors.name = 'Nome é obrigatório';
    if (!form.secret_env_key.trim() && !isEditing) newErrors.secret_env_key = 'Variável de ambiente do secret é obrigatória';
    if (form.config.trim()) {
      try {
        JSON.parse(form.config);
      } catch {
        newErrors.config = 'Config deve ser um JSON válido';
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const parsed = form.config.trim() ? JSON.parse(form.config) : null;
      const config = parsed ? (unmaskConfigForSubmit(parsed) as Record<string, unknown>) : null;
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        secret_env_key: form.secret_env_key.trim() || undefined,
        config,
      };

      if (isEditing && system) {
        const { code, secret_env_key, ...updateData } = payload;
        await integrationAdminApi.updateSystem(system.id, updateData);
        toast('success', 'Sistema atualizado com sucesso');
      } else {
        await integrationAdminApi.createSystem(payload as IntegrationSystemCreateData);
        toast('success', 'Sistema criado com sucesso');
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      const msg = e?.message || 'Erro ao salvar sistema';
      if (msg.includes('Já existe um sistema com este code')) {
        setErrors({ code: 'Já existe um sistema com este código' });
      } else if (msg.includes('Variável de ambiente')) {
        setErrors({ secret_env_key: msg });
      } else {
        toast('error', 'Erro ao salvar', msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setSaving(false);
    onClose();
  };

  const codePattern = '^[a-z0-9_-]+$';

  return (
    <Modal
      open={open}
      title={isEditing ? 'Editar Sistema' : 'Novo Sistema de Integração'}
      subtitle={isEditing ? `Editando ${system?.name}` : 'Configure um novo sistema de integração'}
      onClose={handleClose}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving} icon={saving ? <Loader2 size={14} className="animate-spin" /> : undefined} disabled={saving}>
            {isEditing ? 'Salvar Alterações' : 'Criar Sistema'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {errors.form && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 rounded-xl text-xs font-semibold flex items-center gap-2" role="alert">
            <AlertCircle size={16} /> {errors.form}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Código <span className="text-rose-500">*</span></label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
              placeholder="transferegov"
              pattern={codePattern}
              disabled={isEditing}
              className={errors.code ? 'border-rose-500 focus:ring-rose-500' : ''}
              maxLength={50}
            />
            {errors.code && <p className="text-[10px] text-rose-500 dark:text-rose-400">{errors.code}</p>}
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Apenas letras minúsculas, números, _ e -</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Nome <span className="text-rose-500">*</span></label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Transferegov"
              className={errors.name ? 'border-rose-500 focus:ring-rose-500' : ''}
              maxLength={100}
            />
            {errors.name && <p className="text-[10px] text-rose-500 dark:text-rose-400">{errors.name}</p>}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Descrição</label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Descrição do sistema de integração"
            rows={3}
            className={errors.description ? 'border-rose-500 focus:ring-rose-500' : ''}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Variável de Ambiente do Secret <span className={isEditing ? 'text-slate-400' : 'text-rose-500'}>{isEditing ? '' : ' *'}</span></label>
            <Input
              value={form.secret_env_key}
              onChange={(e) => setForm({ ...form, secret_env_key: e.target.value })}
              placeholder={isEditing ? 'Deixe em branco para não alterar' : 'TRANSFEREGOV_WEBHOOK_SECRET'}
              className={errors.secret_env_key ? 'border-rose-500 focus:ring-rose-500' : ''}
              disabled={isEditing}
            />
            {errors.secret_env_key && <p className="text-[10px] text-rose-500 dark:text-rose-400">{errors.secret_env_key}</p>}
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              {isEditing ? 'Deixe em branco para manter o secret atual' : 'Nome da variável de ambiente onde o secret está armazenado'}
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Adapter</label>
            <Select value={''} onChange={() => {}} disabled>
              <option value="">Será detectado automaticamente pelo código</option>
              {adapters.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
            </Select>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">O adapter é detectado automaticamente pelo código do sistema</p>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Config (JSON)</label>
          <textarea
            value={form.config}
            onChange={(e) => setForm({ ...form, config: e.target.value })}
            placeholder='{ "endpoint": "https://api.exemplo.com", "timeout": 30 }'
            rows={6}
            className={`w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 font-mono text-xs focus:ring-2 focus:ring-brand-600 ${errors.config ? 'border-rose-500 focus:ring-rose-500' : ''}`}
            spellCheck={false}
          />
          {errors.config && <p className="text-[10px] text-rose-500 dark:text-rose-400">{errors.config}</p>}
          <p className="text-[10px] text-slate-400 dark:text-slate-500">Configuração adicional do sistema (opcional). Deve ser um JSON válido.</p>
          {isEditing && form.config.includes('********') && (
            <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle size={11} className="shrink-0" />
              Campos exibidos como ******** mantêm o valor atual. Deixe ******** para manter ou informe um novo valor para substituir.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="peer sr-only"
            />
            <span className="relative w-10 h-6 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600 transition-colors peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Sistema ativo</span>
          </label>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-700/50">
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            <AlertTriangle size={12} className="inline text-amber-500" /> O secret NÃO é armazenado no banco de dados. A variável de ambiente deve estar configurada no servidor.
          </p>
        </div>
      </form>
    </Modal>
  );
}
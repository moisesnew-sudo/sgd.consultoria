import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, Loader2, Save } from 'lucide-react';
import { PermissionCategory, UserPermission } from '../types';
import { permissionsApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';

interface PermissionsModalProps {
  userId: number;
  userName: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function PermissionsModal({ userId, userName, onClose, onSaved }: PermissionsModalProps) {
  const { toast } = useToast();
  const [categories, setCategories] = useState<PermissionCategory[]>([]);
  const [userPerms, setUserPerms] = useState<UserPermission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [cats, perms] = await Promise.all([
        permissionsApi.getAll(),
        permissionsApi.getUserPermissions(userId),
      ]);
      setCategories(cats);
      setUserPerms(perms);
    } catch (e: any) {
      toast('error', 'Erro ao carregar permissões', e?.message || 'Não foi possível carregar');
    } finally {
      setIsLoading(false);
    }
  };

  const isGranted = (permissionId: number): boolean => {
    const found = userPerms.find(p => p.permission_id === permissionId);
    return found ? found.granted : false;
  };

  const togglePermission = (permissionId: number) => {
    setUserPerms(prev => {
      const exists = prev.find(p => p.permission_id === permissionId);
      if (exists) {
        return prev.map(p =>
          p.permission_id === permissionId ? { ...p, granted: !p.granted } : p
        );
      }
      return [...prev, { permission_id: permissionId, key: '', granted: true }];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const permsToSend = userPerms.map(p => ({
        permission_id: p.permission_id,
        granted: p.granted,
      }));
      await permissionsApi.updateUserPermissions(userId, permsToSend);
      toast('success', 'Permissões atualizadas com sucesso');
      onSaved();
      onClose();
    } catch (e: any) {
      toast('error', 'Erro ao salvar permissões', e?.message || 'Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#111a2e] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-700/50">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center">
              <ShieldCheck className="text-brand-600 dark:text-brand-400" size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">Permissões de Acesso</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{userName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-brand-600" />
            </div>
          ) : (
            categories.map((cat) => (
              <div key={cat.category}>
                <div className="mb-3">
                  <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                    {cat.category}
                  </h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {cat.category === 'Dashboard' && 'Acesso ao painel de indicadores'}
                    {cat.category === 'Demandas' && 'Gerenciamento de demandas e solicitações'}
                    {cat.category === 'Relatórios' && 'Relatórios e exportação de dados'}
                    {cat.category === 'Usuários' && 'Gerenciamento de usuários do sistema'}
                    {cat.category === 'Configurações' && 'Configurações gerais do sistema'}
                  </p>
                </div>
                <div className="space-y-2">
                  {cat.permissions.map((perm) => {
                    const granted = isGranted(perm.id);
                    return (
                      <label
                        key={perm.id}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                          granted
                            ? 'bg-brand-50/70 dark:bg-brand-900/15 border-brand-200 dark:border-brand-800/40 shadow-xs'
                            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-semibold transition-colors ${
                            granted ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'
                          }`}>
                            {perm.name}
                          </span>
                          {perm.description && (
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {perm.description}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePermission(perm.id)}
                          className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                            granted
                              ? 'bg-brand-600 hover:bg-brand-500'
                              : 'bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500'
                          }`}
                        >
                          <span
                            className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition-all duration-200 ${
                              granted ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-100 dark:border-slate-700/50">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || isLoading}
            className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs uppercase tracking-wider disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar Permissões
          </button>
        </div>
      </div>
    </div>
  );
}
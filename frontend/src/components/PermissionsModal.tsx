import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, Loader2 } from 'lucide-react';
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
  const [savingId, setSavingId] = useState<number | null>(null);

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

  const toggleAndSave = async (permissionId: number) => {
    if (savingId === permissionId) return;
    setSavingId(permissionId);

    const newGranted = !isGranted(permissionId);

    try {
      const newPerms: UserPermission[] = userPerms.some(p => p.permission_id === permissionId)
        ? userPerms.map(p => p.permission_id === permissionId ? { ...p, granted: newGranted } : p)
        : [...userPerms, { permission_id: permissionId, key: '', granted: newGranted }];

      setUserPerms(newPerms);

      const permsToSend = newPerms.map(p => ({
        permission_id: p.permission_id,
        granted: p.granted,
      }));

      await permissionsApi.updateUserPermissions(userId, permsToSend);
      onSaved();
    } catch (e: any) {
      setUserPerms(prev => prev.map(p =>
        p.permission_id === permissionId ? { ...p, granted: !p.granted } : p
      ));
      toast('error', 'Erro ao salvar', e?.message || 'Não foi possível salvar');
    } finally {
      setSavingId(null);
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
                    const isSaving = savingId === perm.id;
                    const granted = isGranted(perm.id);
                    return (
                      <label
                        key={perm.id}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-colors cursor-pointer ${
                          isSaving
                            ? 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                            : granted
                              ? 'bg-brand-50/60 dark:bg-brand-900/15 border-brand-200 dark:border-brand-800/40'
                              : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {perm.name}
                          </span>
                          {perm.description && (
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {perm.description}
                            </p>
                          )}
                        </div>
                        <div className="relative ml-3">
                          {isSaving ? (
                            <Loader2 size={20} className="animate-spin text-brand-600" />
                          ) : (
                            <div
                              onClick={() => toggleAndSave(perm.id)}
                              className={`w-11 h-6 rounded-full transition-colors cursor-pointer ${
                                granted ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
                              }`}
                            >
                              <div
                                className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform mt-0.5 ${
                                  granted ? 'translate-x-[22px]' : 'translate-x-[2px]'
                                }`}
                              />
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
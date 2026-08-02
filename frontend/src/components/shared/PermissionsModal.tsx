import React, { useEffect, useState } from 'react';
import { ShieldCheck, Save } from 'lucide-react';
import { PermissionCategory, UserPermission } from '../../types';
import { permissionsApi } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

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
      const found = categories.flatMap(c => c.permissions).find(p => p.id === permissionId);
      return [...prev, { permission_id: permissionId, key: found?.key || '', granted: true }];
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
    <Modal
      open
      title="Permissões de Acesso"
      subtitle={userName}
      icon={<ShieldCheck size={22} className="text-brand-600 dark:text-brand-400" />}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || isLoading} loading={saving} icon={<Save size={14} />}>
            Salvar Permissões
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size={32} className="text-brand-600" />
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map((cat) => (
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
          ))}
        </div>
      )}
    </Modal>
  );
}
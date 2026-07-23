import React, { useEffect, useState } from 'react';
import { Users as UsersIcon, ShieldCheck, UserPlus, Trash2, CheckCircle2, XCircle, Loader2, AlertCircle, KeyRound } from 'lucide-react';
import { TableSkeleton } from './ui/Skeleton';
import { User, UserRole } from '../types';
import { authApi, ROLE_LABELS, ROLE_PERMISSIONS } from '../services/api';
import { useToast } from '../contexts/ToastContext';

interface UsersViewProps {
  currentUser: User;
}

const ROLE_STYLES: Record<UserRole, string> = {
  admin: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  gestor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  analista: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  consulta: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export default function UsersView({ currentUser }: UsersViewProps) {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'analista' as UserRole });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setIsLoading(true);
      const data = await authApi.listUsers();
      setUsers(data);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar usuários');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) return;
    setSaving(true);
    try {
      await authApi.createUser({ ...form, email: form.email.trim(), name: form.name.trim() });
      setForm({ name: '', email: '', password: '', role: 'analista' });
      setShowForm(false);
      load();
    } catch (e: any) {
      toast('error', 'Erro ao criar usuário', e?.message || 'Não foi possível criar');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: User) => {
    try {
      await authApi.updateUser(u.id, { active: u.active !== false });
      load();
    } catch (e: any) {
      toast('error', 'Erro ao atualizar', e?.message || 'Não foi possível atualizar');
    }
  };

  const changeRole = async (u: User, role: UserRole) => {
    try {
      await authApi.updateUser(u.id, { role });
      load();
    } catch (e: any) {
      toast('error', 'Erro ao atualizar', e?.message || 'Não foi possível atualizar');
    }
  };

  if (isLoading) {
    return <TableSkeleton rows={5} />;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <UsersIcon className="text-brand-600" size={26} /> Controle de Usuários
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gerencie perfis e permissões de acesso ao sistema.</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all"
        >
          <UserPlus size={16} /> Novo Usuário
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 rounded-xl text-xs font-semibold flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider">Cadastrar Usuário</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Nome *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600" placeholder="Nome completo" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">E-mail *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600" placeholder="usuario@sgd.gov.br" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Senha temporária *</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600" placeholder="Mín. 6 caracteres" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Perfil</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100">
                {(['admin', 'gestor', 'analista', 'consulta'] as UserRole[]).map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs uppercase">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs uppercase disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Criar
            </button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700/50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-4 px-6">Usuário</th>
                <th className="py-4 px-6">Perfil</th>
                <th className="py-4 px-6">Permissões</th>
                <th className="py-4 px-6">Status</th>
                <th className="py-4 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                const perm = ROLE_PERMISSIONS[u.role];
                return (
                  <tr key={u.id} className="text-xs text-slate-600 dark:text-slate-300">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-brand-500 to-brand-800 text-white flex items-center justify-center font-bold text-sm">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-extrabold text-slate-800 dark:text-slate-100">{u.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${ROLE_STYLES[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex flex-wrap gap-1 text-[9px]">
                        {perm.canCreate && <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">Criar</span>}
                        {perm.canEdit && <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">Editar</span>}
                        {perm.canDelete && <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">Excluir</span>}
                        {perm.canManageUsers && <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">Usuários</span>}
                        {!perm.canCreate && !perm.canEdit && <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">Somente leitura</span>}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      {u.active !== false ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold"><CheckCircle2 size={14} /> Ativo</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold"><XCircle size={14} /> Inativo</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {!isSelf && (
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={u.role}
                            onChange={(e) => changeRole(u, e.target.value as UserRole)}
                            className="text-[10px] px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                          >
                            {(['admin', 'gestor', 'analista', 'consulta'] as UserRole[]).map(r => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => toggleActive(u)}
                            title={u.active !== false ? 'Desativar' : 'Ativar'}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            {u.active !== false ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
                          </button>
                        </div>
                      )}
                      {isSelf && <span className="text-[10px] text-slate-400 italic">Você</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

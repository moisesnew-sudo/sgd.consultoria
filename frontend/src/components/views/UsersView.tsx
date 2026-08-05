import React, { useEffect, useState } from 'react';
import { Users as UsersIcon, UserPlus, Loader2, AlertCircle, X, ChevronRight, Save, Trash2, KeyRound, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { TableSkeleton } from '../ui/Skeleton';
import { PageHeader } from '../ui/PageHeader';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Fields';
import { User, UserRole } from '../../types';
import { authApi, permissionsApi, ROLE_LABELS, ROLE_PERMISSIONS } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import PermissionsModal from '../shared/PermissionsModal';

interface UsersViewProps {
  currentUser: User;
}

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  gestor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  analista: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  consulta: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  administrador: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  diretor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  tecnico: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  parceiro: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  cliente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  visitante: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const ALL_ROLES: UserRole[] = ['admin', 'gestor', 'analista', 'consulta', 'diretor', 'tecnico', 'parceiro', 'cliente', 'visitante'];

export default function UsersView({ currentUser }: UsersViewProps) {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'analista' as UserRole });
  const [saving, setSaving] = useState(false);

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('analista');
  const [savingEdit, setSavingEdit] = useState(false);
  const [passwordModal, setPasswordModal] = useState<{ id: number; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [permTarget, setPermTarget] = useState<{ id: number; name: string } | null>(null);

  const load = async () => {
    try {
      setIsLoading(true);
      const data = await authApi.listUsers();
      setUsers(data);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar usuÃ¡rios');
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
      toast('error', 'Erro ao criar usuÃ¡rio', e?.message || 'NÃ£o foi possÃ­vel criar');
    } finally {
      setSaving(false);
    }
  };

  const openDetail = (u: User) => {
    setSelectedUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
  };

  const handleSaveEdit = async () => {
    if (!selectedUser) return;
    if (!editName.trim()) return toast('error', 'Nome obrigatÃ³rio');
    if (!editEmail.trim()) return toast('error', 'Email obrigatÃ³rio');
    setSavingEdit(true);
    try {
      await authApi.updateUser(selectedUser.id, {
        name: editName.trim(),
        email: editEmail.trim(),
        role: editRole,
      });
      toast('success', 'UsuÃ¡rio atualizado');
      setSelectedUser(null);
      load();
    } catch (e: any) {
      toast('error', 'Erro ao salvar', e?.message || 'NÃ£o foi possÃ­vel salvar');
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleActive = async (u: User) => {
    try {
      await authApi.updateUser(u.id, { active: u.active !== false });
      if (selectedUser?.id === u.id) setSelectedUser({ ...u, active: u.active !== false });
      load();
    } catch (e: any) {
      toast('error', 'Erro ao atualizar', e?.message || 'NÃ£o foi possÃ­vel atualizar');
    }
  };

  const handleResetPassword = async () => {
    if (!passwordModal) return;
    if (!newPassword || newPassword.length < 6) return toast('error', 'Senha deve ter no mÃ­nimo 6 caracteres');
    setSavingPassword(true);
    try {
      await authApi.resetPasswordAsAdmin(passwordModal.id, newPassword);
      toast('success', 'Senha alterada com sucesso');
      setPasswordModal(null);
      setNewPassword('');
    } catch (e: any) {
      toast('error', 'Erro ao alterar senha', e?.message || 'NÃ£o foi possÃ­vel alterar');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await authApi.deleteUser(confirmDelete.id);
      toast('success', 'UsuÃ¡rio excluÃ­do');
      setConfirmDelete(null);
      setSelectedUser(null);
      load();
    } catch (e: any) {
      toast('error', 'Erro ao excluir', e?.message || 'NÃ£o foi possÃ­vel excluir');
    }
  };

  if (isLoading) {
    return <TableSkeleton rows={5} />;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Controle de UsuÃ¡rios"
        subtitle="Gerencie perfis e permissÃµes de acesso ao sistema."
        icon={<UsersIcon className="text-brand-600" size={26} />}
        actions={
          <button
            onClick={() => setShowForm(s => !s)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all"
          >
            <UserPlus size={16} /> Novo UsuÃ¡rio
          </button>
        }
      />

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/60 text-rose-600 dark:text-rose-300 rounded-xl text-xs font-semibold flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider">Cadastrar UsuÃ¡rio</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Nome *</label>
              <input lang="pt-BR" spellCheck={true} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600" placeholder="Nome completo" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">E-mail *</label>
              <input type="email" lang="pt-BR" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600" placeholder="usuario@sgd.gov.br" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Senha temporÃ¡ria *</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600" placeholder="MÃ­n. 6 caracteres" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Perfil</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100">
                {ALL_ROLES.map(r => (
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
                <th className="py-4 px-6">UsuÃ¡rio</th>
                <th className="py-4 px-6">Perfil</th>
                <th className="py-4 px-6">Status</th>
                <th className="py-4 px-6 text-right">AÃ§Ãµes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id;
                return (
                  <tr
                    key={u.id}
                    onClick={() => !isSelf && openDetail(u)}
                    className={`text-xs text-slate-600 dark:text-slate-300 ${!isSelf ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors' : ''}`}
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-brand-500 to-brand-800 text-white flex items-center justify-center font-bold text-sm shrink-0">
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
                      {u.active !== false ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold"><CheckCircle2 size={14} /> Ativo</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold"><XCircle size={14} /> Inativo</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {isSelf ? (
                        <span className="text-[10px] text-slate-400 italic">VocÃª</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-brand-600 text-[10px] font-semibold">
                          Gerenciar <ChevronRight size={14} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over detail panel */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedUser(null)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-[#0f1f3a] shadow-2xl border-l border-slate-200 dark:border-slate-700/50 overflow-y-auto animate-slide-left">
            <div className="sticky top-0 z-10 bg-white dark:bg-[#0f1f3a] border-b border-slate-100 dark:border-slate-700/50 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-brand-500 to-brand-800 text-white flex items-center justify-center font-bold text-sm">
                  {selectedUser.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{selectedUser.name}</h3>
                  <p className="text-[10px] text-slate-400">ID: {selectedUser.id}</p>
                </div>
              </div>
              <button onClick={() => setSelectedUser(null)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {/* InformaÃ§Ãµes Gerais */}
              <section>
                <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider mb-4">InformaÃ§Ãµes Gerais</h4>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block">Nome</label>
                    <input lang="pt-BR" spellCheck={true} value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block">E-mail (login)</label>
                    <input lang="pt-BR" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block">Perfil</label>
                    <select value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-brand-600">
                      {ALL_ROLES.map(r => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Status</span>
                    <button
                      onClick={() => toggleActive(selectedUser)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${selectedUser.active !== false ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'}`}
                    >
                      {selectedUser.active !== false ? <><CheckCircle2 size={14} /> Ativo</> : <><XCircle size={14} /> Inativo</>}
                    </button>
                  </div>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs uppercase tracking-wider disabled:opacity-50 transition-all"
                  >
                    {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar AlteraÃ§Ãµes
                  </button>
                </div>
              </section>

              {/* PermissÃµes */}
              <section>
                <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider mb-3">PermissÃµes</h4>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {Object.entries(ROLE_PERMISSIONS[editRole]).map(([key, val]) => {
                    if (val) {
                      const labelMap: Record<string, string> = { canCreate: 'Criar', canEdit: 'Editar', canDelete: 'Excluir', canManageUsers: 'UsuÃ¡rios', canViewUsers: 'Ver UsuÃ¡rios', canManageSettings: 'Config' };
                      return <span key={key} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[9px] font-bold">{labelMap[key] || key}</span>;
                    }
                    return null;
                  })}
                </div>
                <button
                  onClick={() => setPermTarget({ id: selectedUser.id, name: selectedUser.name })}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-600 hover:text-brand-600 dark:hover:border-brand-500 transition-all text-xs font-bold"
                >
                  <ShieldCheck size={16} /> Gerenciar PermissÃµes Individuais
                </button>
              </section>

              {/* SeguranÃ§a */}
              <section>
                <h4 className="text-xs font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider mb-3">SeguranÃ§a</h4>
                <button
                  onClick={() => { setPasswordModal({ id: selectedUser.id, name: selectedUser.name }); setNewPassword(''); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-600 hover:text-brand-600 dark:hover:border-brand-500 transition-all text-xs font-bold"
                >
                  <KeyRound size={16} /> Resetar Senha
                </button>
              </section>

              {/* Zona de Perigo */}
              <section className="border-t border-rose-200 dark:border-rose-800/30 pt-6">
                <h4 className="text-xs font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-3">Zona de Perigo</h4>
                <button
                  onClick={() => setConfirmDelete({ id: selectedUser.id, name: selectedUser.name })}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 transition-all text-xs font-bold"
                >
                  <Trash2 size={16} /> Excluir UsuÃ¡rio
                </button>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Password reset modal */}
      <Modal
        open={!!passwordModal}
        title="Resetar Senha"
        subtitle={passwordModal?.name}
        onClose={() => { setPasswordModal(null); setNewPassword(''); }}
        footer={
          <>
            <Button variant="outline" onClick={() => { setPasswordModal(null); setNewPassword(''); }}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleResetPassword} disabled={savingPassword || newPassword.length < 6} loading={savingPassword} icon={<KeyRound size={14} />}>
              Alterar
            </Button>
          </>
        }
      >
        <Input type="password" label="Nova Senha" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="MÃ­n. 6 caracteres" />
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        open={!!confirmDelete}
        title="Excluir UsuÃ¡rio"
        subtitle={confirmDelete?.name}
        icon={<Trash2 size={20} className="text-rose-600" />}
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete} icon={<Trash2 size={14} />}>
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">Tem certeza? O usuÃ¡rio serÃ¡ desativado e nÃ£o poderÃ¡ mais acessar o sistema.</p>
      </Modal>

      {permTarget && (
        <PermissionsModal
          userId={permTarget.id}
          userName={permTarget.name}
          onClose={() => setPermTarget(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
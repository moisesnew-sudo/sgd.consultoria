import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive, Download, RotateCcw, ShieldCheck, AlertTriangle, RefreshCw, Plus, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { backupsApi } from '../../services/api';
import { formatDate } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Skeleton } from '../ui/Skeleton';
import { ConfirmModal } from '../ui/ConfirmModal';
import { PageHeader } from '../ui/PageHeader';

export default function BackupManagementView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [verifyResult, setVerifyResult] = useState<{ id: number; valid: boolean; stored_hash: string; computed_hash: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBackups(await backupsApi.list()); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await backupsApi.create('manual');
      setBackups(prev => [result, ...prev]);
    } catch { /* ignore */ }
    finally { setCreating(false); }
  };

  const handleVerify = async (id: number) => {
    setVerifying(id);
    setVerifyResult(null);
    try {
      const result = await backupsApi.verify(id);
      setVerifyResult({ id, ...result });
    } catch { /* ignore */ }
    finally { setVerifying(null); }
  };

  const handleRestore = async () => {
    if (!confirmRestore) return;
    setRestoring(confirmRestore);
    try {
      await backupsApi.restore(confirmRestore);
      setConfirmRestore(null);
      toast('success', 'Backup restaurado com sucesso!');
    } catch (e: any) {
      toast('error', 'Erro ao restaurar', e.message);
    } finally { setRestoring(null); }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backups"
        subtitle="Gerencie os backups do sistema"
        icon={<HardDrive className="text-brand-600" />}
        actions={
          <>
            <button onClick={handleCreate} disabled={creating}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
              {creating ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              {creating ? 'Criando...' : 'Novo Backup'}
            </button>
            <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
              <RefreshCw size={16} />
            </button>
          </>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : backups.length === 0 ? (
        <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-8 text-center">
          <HardDrive className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={40} />
          <p className="text-slate-500 dark:text-slate-400">Nenhum backup encontrado. Crie o primeiro backup.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map(b => (
            <div key={b.id} className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 dark:text-white text-sm">{b.filename}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      b.backup_type === 'daily' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                      b.backup_type === 'weekly' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                      b.backup_type === 'monthly' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    }`}>{b.backup_type}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      b.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
                      'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    }`}>{b.status}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    <span>{formatDate(b.created_at)}</span>
                    <span>{formatBytes(b.file_size)}</span>
                    <span className="font-mono text-[10px]">SHA-256: {b.sha256_hash?.substring(0, 16)}...</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a href={backupsApi.download(b.id)}
                    className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500"
                    title="Download">
                    <Download size={14} />
                  </a>
                  <button onClick={() => handleVerify(b.id)} disabled={verifying === b.id}
                    className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500"
                    title="Verificar integridade">
                    {verifying === b.id ? <Loader2 className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
                  </button>
                  <button onClick={() => setConfirmRestore(b.id)} disabled={restoring !== null}
                    className="p-2 rounded-lg border border-amber-200 hover:bg-amber-50 text-amber-600 dark:border-amber-800 dark:hover:bg-amber-900/20"
                    title="Restaurar">
                    {restoring === b.id ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                  </button>
                </div>
              </div>
              {(() => {
                const vr = verifyResult;
                if (!vr || vr.id !== b.id) return null;
                return (
                  <div className={`mt-3 flex items-center gap-2 p-2 rounded-lg text-xs ${
                    vr.valid
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'
                      : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                  }`}>
                    {vr.valid ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    <span>{vr.valid ? 'Integridade verificada' : 'Hash não corresponde! Backup corrompido?'}</span>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmRestore !== null}
        title="Restaurar Backup"
        message="Tem certeza que deseja restaurar este backup? Todos os dados atuais serão substituídos e todas as sessões serão encerradas. Esta ação não pode ser desfeita."
        confirmLabel="Restaurar"
        variant="danger"
        loading={restoring !== null}
        onConfirm={handleRestore}
        onCancel={() => setConfirmRestore(null)}
      />
    </div>
  );
}

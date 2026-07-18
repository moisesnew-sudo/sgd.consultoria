import React, { useState, useRef } from 'react';
import { Database, Download, Upload, FileJson, ShieldCheck, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { settingsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function BackupView() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await settingsApi.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SGD_Backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ type: 'ok', text: 'Backup exportado com sucesso (demandas, municípios, usuários, trâmites, anexos, comentários e auditoria).' });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message || 'Erro ao exportar backup.' });
    } finally {
      setBusy(false);
    }
  };

  const handleImportClick = () => fileRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.data) throw new Error('Arquivo de backup inválido.');
      await settingsApi.importData(parsed);
      setMessage({ type: 'ok', text: 'Backup restaurado com sucesso. Recarregue a página para ver os dados.' });
    } catch (err: any) {
      setMessage({ type: 'err', text: 'Falha na restauração: ' + (err.message || 'arquivo inválido.') });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <Database className="text-emerald-600" /> Backup & Restauração
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Exporte um arquivo JSON completo do banco ou restaure a partir de um backup.
        </p>
      </div>

      {message && (
        <div className={`flex items-start gap-2 p-3 rounded-xl border text-sm ${
          message.type === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800'
            : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800'
        }`}>
          {message.type === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-5 space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase">
            <Download size={14} /> Exportar Backup
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Gera um arquivo <code className="font-mono">.json</code> com todas as tabelas do sistema. Recomendado antes de grandes alterações.
          </p>
          <button
            onClick={handleExport}
            disabled={busy}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileJson size={14} />}
            Baixar Backup
          </button>
        </div>

        <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-5 space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase">
            <Upload size={14} /> Restaurar Backup
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Substitui todos os dados atuais pelo conteúdo do arquivo. <strong>Ação irreversível.</strong>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFile}
            className="hidden"
          />
          <button
            onClick={handleImportClick}
            disabled={busy}
            className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Selecionar Arquivo
          </button>
          {fileName && <p className="text-[10px] text-slate-400 truncate">Selecionado: {fileName}</p>}
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 text-[11px] text-slate-500">
        <ShieldCheck size={14} className="mt-0.5 text-emerald-500 shrink-0" />
        <span>O backup é criptografado apenas em trânsito (HTTPS). Armazene o arquivo em local seguro. O restore requer perfil de Administrador.</span>
      </div>
    </div>
  );
}

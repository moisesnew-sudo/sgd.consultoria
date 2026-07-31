import React, { useState, useEffect } from 'react';
import { Clock, User, Code2, Monitor } from 'lucide-react';
import { demandVersionsApi } from '../services/api';
import { formatDate } from '../services/api';
import { DemandVersion } from '../types';

export default function DemandHistory({ demandId }: { demandId: string }) {
  const [versions, setVersions] = useState<DemandVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<DemandVersion | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await demandVersionsApi.list(demandId);
        setVersions(data);
        if (data.length > 0) setSelectedVersion(data[0]);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [demandId]);

  const diffKeys = (v1: any, v2: any) => {
    if (!v1 || !v2) return [];
    const allKeys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
    const changes: { key: string; from: any; to: any }[] = [];
    allKeys.forEach(k => {
      if (k === 'created_at' || k === 'updated_at' || k === 'created_by') return;
      const oldVal = JSON.stringify(v1[k]);
      const newVal = JSON.stringify(v2[k]);
      if (oldVal !== newVal) {
        changes.push({ key: k, from: v1[k], to: v2[k] });
      }
    });
    return changes;
  };

  if (loading) return <div className="p-4 text-sm text-slate-400 italic">Carregando histórico...</div>;
  if (versions.length === 0) return <div className="p-4 text-sm text-slate-400 italic">Nenhum histórico de alterações disponível.</div>;

  return (
    <div className="flex flex-col md:flex-row gap-4 min-h-[300px]">
      <div className="w-full md:w-48 shrink-0 space-y-1">
        {versions.map(v => (
          <button key={v.id} onClick={() => setSelectedVersion(v)}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
              selectedVersion?.id === v.id
                ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-medium'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
            }`}>
            <div className="font-medium">v{v.version}</div>
            <div className="text-[10px] opacity-70">{formatDate(v.created_at)}</div>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        {selectedVersion && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              <span className="flex items-center gap-1"><User size={12} /> {selectedVersion.changed_by_name}</span>
              <span className="flex items-center gap-1"><Clock size={12} /> {formatDate(selectedVersion.created_at)}</span>
              {selectedVersion.ip_address && (
                <span className="flex items-center gap-1"><Monitor size={12} /> IP: {selectedVersion.ip_address}</span>
              )}
            </div>

            {selectedVersion.version > 1 && versions.length > 1 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                <h4 className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1">
                  <Code2 size={12} /> Alterações nesta versão
                </h4>
                {(() => {
                  const prev = versions.find(v => v.version === selectedVersion.version - 1);
                  if (!prev) return null;
                  const changes = diffKeys(prev.snapshot, selectedVersion.snapshot);
                  return changes.length > 0 ? (
                    <div className="space-y-2">
                      {changes.map(c => (
                        <div key={c.key} className="text-xs">
                          <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">{c.key.replace(/_/g, ' ')}:</span>
                          <div className="flex items-start gap-2 mt-0.5">
                            <span className="px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded line-through text-[10px] break-all max-w-[45%]">{String(c.from ?? '(vazio)')}</span>
                            <span className="text-slate-400">→</span>
                            <span className="px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded text-[10px] break-all max-w-[45%]">{String(c.to ?? '(vazio)')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-slate-400 italic">Nenhuma alteração detectada nos campos principais</p>;
                })()}
              </div>
            )}

            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 overflow-x-auto">
              <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                {JSON.stringify(selectedVersion.snapshot, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

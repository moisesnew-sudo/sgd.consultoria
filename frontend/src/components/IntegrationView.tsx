import React, { useState, useEffect } from 'react';
import { Plug, KeyRound, Copy, Check, Code2, Webhook, RefreshCw } from 'lucide-react';
import { integrationsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  POST: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  PUT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export default function IntegrationView() {
  const { user } = useAuth();
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setInfo(await integrationsApi.getInfo());
    } catch (e) {
      console.error('Integration load error', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const curlExample = info
    ? `curl -X POST "${info.baseUrl}/demands" \\\n  -H "Authorization: Bearer ${info.apiToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Nova Obra","municipality":"SALVADOR","uf":"BA","category":"Obras","priority":"alta","requested_value":150000}'`
    : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Plug className="text-violet-600" /> API & Integrações
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Conecte o SGD a outros sistemas via REST API</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800" title="Atualizar">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-slate-900 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : info ? (
        <>
          {/* Token + Base URL */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase">
                <KeyRound size={13} /> Token de API (Servidor-a-Servidor)
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2 py-1.5 bg-slate-900 text-emerald-300 rounded-lg text-[11px] font-mono truncate">{info.apiToken}</code>
                <button onClick={() => copy(info.apiToken, 'token')} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                  {copied === 'token' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">Use como <code>Authorization: Bearer</code>. Rotacione alterando o JWT_SECRET.</p>
            </div>

            <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase">
                <Webhook size={13} /> Base URL
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2 py-1.5 bg-slate-900 text-blue-300 rounded-lg text-[11px] font-mono truncate">{info.baseUrl}</code>
                <button onClick={() => copy(info.baseUrl, 'url')} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                  {copied === 'url' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">{info.note}</p>
            </div>
          </div>

          {/* Endpoints table */}
          <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Code2 size={14} /> Endpoints Disponíveis
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 text-left text-[10px] uppercase font-bold text-slate-500">
                    <th className="px-4 py-2">Método</th>
                    <th className="px-4 py-2">Rota</th>
                    <th className="px-4 py-2">Auth</th>
                    <th className="px-4 py-2">Descrição</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {info.endpoints.map((e: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${METHOD_COLORS[e.method] || 'bg-slate-100 text-slate-600'}`}>{e.method}</span>
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">{e.path}</td>
                      <td className="px-4 py-2 text-xs">{e.auth ? <span className="text-amber-600 font-bold">🔒 JWT</span> : <span className="text-slate-400">Público</span>}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{e.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* cURL example */}
          <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase">
                <Code2 size={13} /> Exemplo (cURL)
              </div>
              <button onClick={() => copy(curlExample, 'curl')} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                {copied === 'curl' ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              </button>
            </div>
            <pre className="bg-slate-900 text-emerald-200 rounded-lg p-3 text-[11px] font-mono overflow-x-auto whitespace-pre">{curlExample}</pre>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400 italic">Não foi possível carregar as informações de integração.</p>
      )}
    </div>
  );
}

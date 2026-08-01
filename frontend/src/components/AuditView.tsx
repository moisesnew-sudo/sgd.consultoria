import React from 'react';
import { ScrollText } from 'lucide-react';
import AuditTrail from './AuditTrail';

export default function AuditView() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <ScrollText className="text-emerald-600" /> Trilha de Auditoria
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Registro imutável de todas as ações no sistema</p>
        </div>
      </div>
      <AuditTrail />
    </div>
  );
}

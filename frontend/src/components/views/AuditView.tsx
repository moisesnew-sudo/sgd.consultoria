import React from 'react';
import { ScrollText } from 'lucide-react';
import AuditTrail from '../shared/AuditTrail';
import { PageHeader } from '../ui';

export default function AuditView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Trilha de Auditoria"
        subtitle="Registro imutável de todas as ações no sistema"
        icon={<ScrollText className="text-emerald-600" />}
      />
      <AuditTrail />
    </div>
  );
}

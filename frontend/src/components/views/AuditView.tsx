import { ScrollText } from 'lucide-react';
import AuditTimeline from '../shared/AuditTimeline';
import { PageHeader } from '../ui';

export default function AuditView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Timeline de Auditoria"
        subtitle="Histórico completo de ações no sistema com antes/depois"
        icon={<ScrollText className="text-emerald-600" />}
      />
      <AuditTimeline />
    </div>
  );
}

import React from 'react';
import { Lightbulb } from 'lucide-react';
import { RM, fc, fmt } from './report-utils';
import ReportHeader from './ReportHeader';
import ReportFooter from './ReportFooter';

interface Props {
  metrics: RM;
  pageNumber: number;
  totalPages: number;
  dateStr: string;
}

export default function ReportInsights({ metrics, pageNumber, totalPages, dateStr }: Props) {
  const items = [
    { label: 'Município com mais demandas', value: metrics.topMuni.name, detail: `${metrics.topMuni.count} demandas` },
    { label: 'Município com maior valor', value: metrics.topMuniVal.name, detail: fmt(metrics.topMuniVal.value) },
    { label: 'Status predominante', value: metrics.topStatus.name, detail: `${metrics.topStatus.count} (${metrics.topStatus.pct}%)` },
    { label: 'Prioridade predominante', value: metrics.topPri.name, detail: `${metrics.topPri.count} (${metrics.topPri.pct}%)` },
    { label: 'Maior proposta', value: fc(metrics.maxD.value), detail: metrics.maxD.title },
    { label: 'Menor proposta', value: fc(metrics.minD.value), detail: metrics.minD.title },
    { label: 'Órgão mais demandado', value: metrics.topOrgan.name, detail: `${metrics.topOrgan.count} demandas` },
    { label: 'Demandas críticas', value: String(metrics.critical), detail: `${metrics.total > 0 ? ((metrics.critical / metrics.total) * 100).toFixed(1) : 0}% do total` },
    { label: 'Demandas fora do SLA', value: String(metrics.overdue), detail: 'Acima do prazo' },
    { label: 'Valor médio por demanda', value: fc(metrics.avgValue), detail: 'Média geral' },
  ];

  return (
    <div className="rpage">
      <ReportHeader pageNumber={pageNumber} totalPages={totalPages} dateStr={dateStr} />
      <div className="rpage-body">
        <h2 className="rsection-title" style={{ marginBottom: '1.5rem' }}>
          <Lightbulb size={20} color="#f59e0b" /> Insights Automáticos
        </h2>
        <div className="insight-grid">
          {items.map(ins => (
            <div key={ins.label} className="insight-card">
              <p className="insight-label">{ins.label}</p>
              <p className="insight-value" title={ins.value}>{ins.value || '—'}</p>
              <p className="insight-detail" title={ins.detail}>{ins.detail}</p>
            </div>
          ))}
        </div>
      </div>
      <ReportFooter dateStr={dateStr} />
    </div>
  );
}

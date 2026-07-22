import React from 'react';
import { FileText, TrendingUp, Award, CheckCircle2, X } from 'lucide-react';
import { RM, fc } from './report-utils';
import ReportHeader from './ReportHeader';
import ReportFooter from './ReportFooter';

const iconMap = { FileText: 'indigo', TrendingUp: 'blue', CheckCircle2: 'emerald', Award: 'green', X: 'red' } as const;

interface Props {
  metrics: RM;
  pageNumber: number;
  totalPages: number;
  dateStr: string;
}

export default function ReportIndicators({ metrics, pageNumber, totalPages, dateStr }: Props) {
  const kpiIcon = (name: string) => {
    const icons: Record<string, React.ReactNode> = {
      FileText: <FileText size={20} />,
      TrendingUp: <TrendingUp size={20} />,
      CheckCircle2: <CheckCircle2 size={20} />,
      Award: <Award size={20} />,
      X: <X size={20} />
    };
    return icons[name] || null;
  };
  const colorMap: Record<string, string> = {
    indigo: '#eef2ff', blue: '#eff6ff', emerald: '#ecfdf5', green: '#f0fdf4', red: '#fef2f2', amber: '#fffbeb'
  };
  const iconColorMap: Record<string, string> = {
    indigo: '#6366f1', blue: '#3b82f6', emerald: '#10b981', green: '#22c55e', red: '#f43f5e', amber: '#f59e0b'
  };

  return (
    <div className="rpage">
      <ReportHeader pageNumber={pageNumber} totalPages={totalPages} dateStr={dateStr} />
      <div className="rpage-body">
        <h2 className="rsection-title" style={{ marginBottom: '1.5rem' }}>Indicadores Gerenciais</h2>
        <div className="kpi-grid">
          {[
            { label: 'Total de Demandas', value: String(metrics.total), icon: 'FileText', color: 'indigo' },
            { label: 'Valor Solicitado', value: fc(metrics.totalValue), icon: 'TrendingUp', color: 'blue' },
            { label: 'Valor Aprovado', value: fc(metrics.approvedValue), icon: 'CheckCircle2', color: 'emerald' },
            { label: 'Valor Concluído', value: fc(metrics.concludedValue), icon: 'Award', color: 'green' },
            { label: 'Valor Rejeitado', value: fc(metrics.rejectedValue), icon: 'X', color: 'red' },
            { label: 'Taxa de Aprovação', value: `${metrics.approvalRate}%`, icon: 'TrendingUp', color: 'amber' },
          ].map(k => (
            <div key={k.label} className="kpi-card">
              <div className="kpi-icon" style={{ background: colorMap[k.color], color: iconColorMap[k.color] }}>
                {kpiIcon(k.icon)}
              </div>
              <div>
                <p className="kpi-label">{k.label}</p>
                <p className="kpi-value">{k.value}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="kpi-mini-grid">
          {[
            { label: 'Municípios', value: String(metrics.municipalities), hint: 'Atendidos' },
            { label: 'Estados', value: String(metrics.states), hint: 'Envolvidos' },
            { label: 'Órgãos', value: String(metrics.organs), hint: 'Demandantes' },
            { label: 'Tempo Médio', value: metrics.avgTime > 0 ? `${metrics.avgTime.toFixed(1)}d` : '—', hint: 'Até conclusão' },
            { label: 'Valor Médio', value: fc(metrics.avgValue), hint: 'Por demanda' },
            { label: 'Taxa Conclusão', value: `${metrics.conclusionRate}%`, hint: `${metrics.concludedCount} concluídas` },
          ].map(k => (
            <div key={k.label} className="kpi-mini-card">
              <p className="kpi-mini-label">{k.label}</p>
              <p className="kpi-mini-value">{k.value}</p>
              <p className="kpi-mini-hint">{k.hint}</p>
            </div>
          ))}
        </div>
      </div>
      <ReportFooter dateStr={dateStr} />
    </div>
  );
}

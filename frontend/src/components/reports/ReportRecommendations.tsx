import React from 'react';
import { Target } from 'lucide-react';
import ReportHeader from './ReportHeader';
import ReportFooter from './ReportFooter';

interface Props {
  recommendations: string[];
  pageNumber: number;
  totalPages: number;
  dateStr: string;
  timeStr: string;
}

export default function ReportRecommendations({ recommendations, pageNumber, totalPages, dateStr, timeStr }: Props) {
  return (
    <div className="rpage">
      <ReportHeader pageNumber={pageNumber} totalPages={totalPages} dateStr={dateStr} />
      <div className="rpage-body">
        <h2 className="rsection-title" style={{ marginBottom: '1.5rem' }}>
          <Target size={20} color="#059669" /> Recomendações Estratégicas
        </h2>
        <div className="rec-list">
          {recommendations.map((rec, i) => (
            <div key={i} className="rec-item">
              <span className="rec-number">{i + 1}</span>
              <p className="rec-text">{rec}</p>
            </div>
          ))}
        </div>
        <div className="report-conclusion">
          <p className="system-name">Sistema de Gestão de Demandas — SGD</p>
          <p>Relatório gerado automaticamente em {dateStr} às {timeStr}</p>
          <p style={{ fontSize: 9, color: '#cbd5e1' }}>Este documento é confidencial e destinado ao uso interno.</p>
        </div>
      </div>
      <ReportFooter dateStr={dateStr} timeStr={timeStr} />
    </div>
  );
}

import React from 'react';
import { BrainCircuit } from 'lucide-react';
import ReportHeader from './ReportHeader';
import ReportFooter from './ReportFooter';

interface Props {
  analysis: string[];
  pageNumber: number;
  totalPages: number;
  dateStr: string;
}

export default function ReportAnalysis({ analysis, pageNumber, totalPages, dateStr }: Props) {
  return (
    <div className="rpage">
      <ReportHeader pageNumber={pageNumber} totalPages={totalPages} dateStr={dateStr} />
      <div className="rpage-body">
        <h2 className="rsection-title" style={{ marginBottom: '1.5rem' }}>
          <BrainCircuit size={20} color="#6366f1" /> Análise da IA
        </h2>
        <div className="analysis-text">
          {analysis.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </div>
      <ReportFooter dateStr={dateStr} />
    </div>
  );
}

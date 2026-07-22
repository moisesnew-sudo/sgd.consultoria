import React, { useState, useEffect, useMemo } from 'react';
import { X, Printer, Download, Sparkles } from 'lucide-react';
import { Demand } from '../types';
import { computeMetrics, genAnalysis, genRecommendations, fmt, SL, PL } from './reports/report-utils';
import ReportCover from './reports/ReportCover';
import ReportIndicators from './reports/ReportIndicators';
import ReportAnalysis from './reports/ReportAnalysis';
import ReportInsights from './reports/ReportInsights';
import ReportCharts from './reports/ReportCharts';
import ReportTable from './reports/ReportTable';
import ReportRecommendations from './reports/ReportRecommendations';
import './reports/print.css';

interface Props {
  demands: Demand[];
  filters: { uf: string; status: string; priority: string; ano: string };
  onClose: () => void;
}

export default function ExecutiveReport({ demands, filters, onClose }: Props) {
  const [stage, setStage] = useState(0);
  const metrics = useMemo(() => computeMetrics(demands), [demands]);
  const analysis = useMemo(() => genAnalysis(metrics), [metrics]);
  const recommendations = useMemo(() => genRecommendations(metrics), [metrics]);

  useEffect(() => {
    if (stage < 3) { const t = setTimeout(() => setStage(s => s + 1), 700); return () => clearTimeout(t); }
  }, [stage]);

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const shortDate = now.toLocaleDateString('pt-BR');

  const filterParts: string[] = [];
  if (filters.uf) filterParts.push(`UF: ${filters.uf}`);
  if (filters.status) filterParts.push(`Status: ${SL[filters.status as keyof typeof SL] || filters.status}`);
  if (filters.priority) filterParts.push(`Prioridade: ${PL[filters.priority as keyof typeof PL] || filters.priority}`);
  if (filters.ano) filterParts.push(`Ano: ${filters.ano}`);
  const filterLabel = filterParts.length > 0 ? filterParts.join(' | ') : 'Sem filtros';

  const handlePrint = () => { setTimeout(() => window.print(), 300); };

  const userLabel = 'Administrador';

  if (stage < 3) {
    const msgs = ['Analisando as demandas...', 'Gerando insights estratégicos...', 'Finalizando relatório...'];
    return (
      <div className="report-loading">
        <div className="report-loading-inner">
          <div style={{ position: 'relative' }}>
            <div className="report-loading-spinner" />
            <div className="report-loading-icon" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={28} color="#a5b4fc" />
            </div>
          </div>
          <p className="report-loading-msg">{msgs[stage]}</p>
          <div className="report-loading-dots">
            {[0, 1, 2].map(i => (
              <span key={i} className="report-loading-dot" style={{ backgroundColor: i <= stage ? '#818cf8' : '#3730a3', transform: i <= stage ? 'scale(1)' : 'scale(0.75)' }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const totalPages = 7;

  return (
    <div className="report-overlay">
      <div className="report-inner">
        <div className="report-toolbar no-print">
          <button className="btn-close" onClick={onClose}><X size={14} /> Fechar</button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-print" onClick={handlePrint}><Printer size={14} /> Imprimir</button>
            <button className="btn-print" onClick={handlePrint}><Download size={14} /> Exportar PDF</button>
          </div>
        </div>

        <div className="report-document">
          <ReportCover
            dateStr={dateStr}
            timeStr={timeStr}
            shortDate={shortDate}
            filterLabel={filterLabel}
            totalDemands={metrics.total}
            municipalities={metrics.municipalities}
            totalValue={fmt(metrics.totalValue)}
            userLabel={userLabel}
          />
          <ReportIndicators metrics={metrics} pageNumber={2} totalPages={totalPages} dateStr={shortDate} />
          <ReportAnalysis analysis={analysis} pageNumber={3} totalPages={totalPages} dateStr={shortDate} />
          <ReportInsights metrics={metrics} pageNumber={4} totalPages={totalPages} dateStr={shortDate} />
          <ReportCharts metrics={metrics} pageNumber={5} totalPages={totalPages} dateStr={shortDate} />
          <ReportTable demands={demands} pageNumber={6} totalPages={totalPages} dateStr={shortDate} />
          <ReportRecommendations
            recommendations={recommendations}
            pageNumber={7}
            totalPages={totalPages}
            dateStr={dateStr}
            timeStr={timeStr}
          />
        </div>
      </div>
    </div>
  );
}

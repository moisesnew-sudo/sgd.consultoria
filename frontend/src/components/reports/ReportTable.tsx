import React from 'react';
import { Demand } from '../../types';
import { fmt, fd, SL, SC, PL, PC } from './report-utils';
import ReportHeader from './ReportHeader';
import ReportFooter from './ReportFooter';

interface Props {
  demands: Demand[];
  pageNumber: number;
  totalPages: number;
  dateStr: string;
}

export default function ReportTable({ demands, pageNumber, totalPages, dateStr }: Props) {
  return (
    <div className="rpage">
      <ReportHeader pageNumber={pageNumber} totalPages={totalPages} dateStr={dateStr} />
      <div className="rpage-body">
        <h2 className="rsection-title" style={{ marginBottom: '0.5rem' }}>Tabela Executiva</h2>
        <p className="rsection-subtitle">{demands.length} demandas</p>
        <div className="rtable-wrap">
          <table className="rtable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Título</th>
                <th>Município/UF</th>
                <th>Órgão</th>
                <th>Ano</th>
                <th>Status</th>
                <th>Prioridade</th>
                <th>Valor</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {demands.map((d, i) => (
                <tr key={d.id}>
                  <td className="cell-id">{d.id}</td>
                  <td className="cell-title" title={d.title}>{d.title}</td>
                  <td className="cell-muni">{d.municipality}/{d.uf}</td>
                  <td className="cell-organ" title={d.organ || ''}>{d.organ || '—'}</td>
                  <td className="cell-ano">{d.ano || '—'}</td>
                  <td>
                    <span className="cell-status" style={{ backgroundColor: `${SC[d.status]}18`, color: SC[d.status] }}>
                      {SL[d.status as keyof typeof SL] || d.status}
                    </span>
                  </td>
                  <td>
                    <span className="cell-priority" style={{ color: PC[d.priority] }}>
                      {PL[d.priority as keyof typeof PL] || d.priority}
                    </span>
                  </td>
                  <td className="cell-value">{fmt(d.requested_value || 0)}</td>
                  <td className="cell-date">{fd(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ReportFooter dateStr={dateStr} />
    </div>
  );
}

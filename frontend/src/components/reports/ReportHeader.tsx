import React from 'react';

interface Props {
  pageNumber: number;
  totalPages: number;
  dateStr: string;
}

export default function ReportHeader({ pageNumber, totalPages, dateStr }: Props) {
  return (
    <div className="rpage-header">
      <div className="rpage-header-left">
        <div className="rpage-header-logo"><span>SGD</span></div>
        <span className="rpage-header-text">Sistema de Gestão de Demandas — Relatório Executivo</span>
      </div>
      <span className="rpage-header-page">{dateStr} | Página {pageNumber} de {totalPages}</span>
    </div>
  );
}

import React from 'react';

interface Props {
  dateStr: string;
  timeStr: string;
  shortDate: string;
  filterLabel: string;
  totalDemands: number;
  municipalities: number;
  totalValue: string;
  userLabel: string;
}

export default function ReportCover({ dateStr, timeStr, shortDate, filterLabel, totalDemands, municipalities, totalValue, userLabel }: Props) {
  return (
    <div className="rpage-cover">
      <div className="cover-body">
        <div className="cover-logo">
          <div className="cover-logo-icon"><span>SGD</span></div>
          <div className="cover-logo-text">
            <p>Sistema de Gestão de Demandas</p>
            <p>Plataforma de Análise e Acompanhamento</p>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span className="cover-badge">Relatório Executivo</span>
          <h1 className="cover-title">RELATÓRIO EXECUTIVO</h1>
          <p className="cover-subtitle">Análise Inteligente das Demandas</p>
          <div className="cover-info">
            <div className="row"><span className="label">Data de emissão</span><span className="value">{dateStr}</span></div>
            <div className="row"><span className="label">Horário</span><span className="value">{timeStr}</span></div>
            <div className="row"><span className="label">Usuário</span><span className="value">{userLabel}</span></div>
            <div className="row"><span className="label">Filtros aplicados</span><span className="value">{filterLabel}</span></div>
            <div className="row"><span className="label">Total de demandas</span><span className="value">{totalDemands}</span></div>
            <div className="row"><span className="label">Municípios envolvidos</span><span className="value">{municipalities}</span></div>
            <div className="row"><span className="label">Valor total solicitado</span><span className="value">{totalValue}</span></div>
          </div>
        </div>
      </div>
      <div className="cover-footer">
        <span>Documento Confidencial</span>
        <span>Sistema de Gestão de Demandas</span>
        <span>{shortDate}</span>
      </div>
    </div>
  );
}

import React from 'react';

interface Props {
  dateStr: string;
  timeStr?: string;
}

export default function ReportFooter({ dateStr, timeStr }: Props) {
  return (
    <div className="rpage-footer">
      <span>Documento Confidencial</span>
      <span>Sistema de Gestão de Demandas</span>
      <span>{dateStr}{timeStr ? ` às ${timeStr}` : ''}</span>
    </div>
  );
}

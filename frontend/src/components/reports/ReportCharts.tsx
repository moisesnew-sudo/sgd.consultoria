import React from 'react';
import { BarChart3 } from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line
} from 'recharts';
import { RM, fc, SL, SC, PL, PC, UC } from './report-utils';
import ReportHeader from './ReportHeader';
import ReportFooter from './ReportFooter';

interface Props {
  metrics: RM;
  pageNumber: number;
  totalPages: number;
  dateStr: string;
}

export default function ReportCharts({ metrics, pageNumber, totalPages, dateStr }: Props) {
  const statusPie = Object.entries(metrics.byStatus).map(([k, v]) => ({ name: SL[k as keyof typeof SL] || k, value: v, color: SC[k] }));
  const priorityPie = Object.entries(metrics.byPriority).map(([k, v]) => ({ name: PL[k as keyof typeof PL] || k, value: v, color: PC[k] }));
  const ufData = Object.entries(metrics.byUf).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 8);
  const topMun = Object.entries(metrics.byMun).map(([k, v]) => ({ name: k.split('/')[0], value: v.value })).sort((a, b) => b.value - a.value).slice(0, 10);

  return (
    <div className="rpage">
      <ReportHeader pageNumber={pageNumber} totalPages={totalPages} dateStr={dateStr} />
      <div className="rpage-body">
        <h2 className="rsection-title" style={{ marginBottom: '1.5rem' }}>
          <BarChart3 size={20} color="#6366f1" /> Análise Gráfica
        </h2>
        <div className="chart-section">
          <div className="chart-row">
            <div className="chart-box avoid-break">
              <p className="chart-box-title">Distribuição por Status</p>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={statusPie} dataKey="value" innerRadius={40} outerRadius={75} paddingAngle={2}>
                    {statusPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="chart-legend">
                {statusPie.map(e => (
                  <div key={e.name} className="chart-legend-item">
                    <span className="chart-legend-dot" style={{ background: e.color }} />
                    {e.name}: <strong>{e.value}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="chart-box avoid-break">
              <p className="chart-box-title">Distribuição por Prioridade</p>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={priorityPie} dataKey="value" innerRadius={40} outerRadius={75} paddingAngle={2}>
                    {priorityPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="chart-legend">
                {priorityPie.map(e => (
                  <div key={e.name} className="chart-legend-item">
                    <span className="chart-legend-dot" style={{ background: e.color }} />
                    {e.name}: <strong>{e.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-row">
            <div className="chart-box avoid-break">
              <p className="chart-box-title">Demandas por Estado</p>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={ufData} dataKey="value" innerRadius={40} outerRadius={75} paddingAngle={2}>
                    {ufData.map((e, i) => <Cell key={i} fill={UC[i % UC.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="chart-uf-labels">
                {ufData.map(e => <span key={e.name} className="chart-uf-label">{e.name}</span>)}
              </div>
            </div>
            <div className="chart-box avoid-break">
              <p className="chart-box-title">Evolução por Ano</p>
              <ResponsiveContainer width="100%" height={190}>
                <LineChart data={metrics.byYear} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Line type="monotone" dataKey="count" name="Demandas" stroke="#3b5bdb" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="chart-full avoid-break">
            <p className="chart-box-title">Top 10 — Valor por Município</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topMun} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => fc(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} width={95} />
                <Bar dataKey="value" fill="#3b5bdb" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <ReportFooter dateStr={dateStr} />
    </div>
  );
}

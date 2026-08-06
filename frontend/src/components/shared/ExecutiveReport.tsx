import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Demand } from '../../types';
import { buildPdfReport, ReportFilters } from '../reports/pdfAutoReport';
import { Spinner } from '../ui/Spinner';

interface ReportFiltersInput {
  search?: string;
  uf?: string;
  municipality?: string;
  organ?: string;
  proposal?: string;
  object?: string;
  status?: string;
  priority?: string;
  ano?: string;
  responsible?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  valueMin?: string;
  valueMax?: string;
}

interface Props {
  demands: Demand[];
  filters: ReportFiltersInput;
  reportType?: string;
  userLabel: string;
  onClose: () => void;
}

const REPORT_TITLES: Record<string, string> = {
  executivo: 'RELATÓRIO EXECUTIVO DE DEMANDAS',
  municipio: 'RELATÓRIO POR MUNICÍPIO',
  estado: 'RELATÓRIO POR ESTADO',
  orgao: 'RELATÓRIO POR ÓRGÃO',
};

export default function ExecutiveReport({ demands, filters, reportType = 'executivo', userLabel, onClose }: Props) {
  const [msg, setMsg] = useState('Preparando relatório...');

  useEffect(() => {
    let cancelled = false;
    setMsg('Processando dados...');
    const timer = setTimeout(async () => {
      setMsg('Gerando documento...');
      try {
        const reportFilters: ReportFilters = {
          search: filters.search || undefined,
          uf: filters.uf || undefined,
          municipality: filters.municipality || undefined,
          organ: filters.organ || undefined,
          proposal_number: filters.proposal || undefined,
          object: filters.object || undefined,
          status: filters.status || undefined,
          priority: filters.priority || undefined,
          ano: filters.ano || undefined,
          responsible: filters.responsible || undefined,
          dateFrom: filters.createdFrom || undefined,
          dateTo: filters.createdTo || undefined,
          updatedFrom: filters.updatedFrom || undefined,
          updatedTo: filters.updatedTo || undefined,
          valueMin: filters.valueMin || undefined,
          valueMax: filters.valueMax || undefined,
        };
        await buildPdfReport({
          demands,
          filters: reportFilters,
          userLabel: userLabel || 'Administrador',
          mode: 'full',
          open: true,
          title: REPORT_TITLES[reportType] || REPORT_TITLES.executivo,
          fileName: `sgd-relatorio-executivo-${new Date().toISOString().slice(0, 10)}.pdf`,
        });
      } catch (error) {
        console.error('Erro ao gerar relatório:', error);
      } finally {
        if (!cancelled) onClose();
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [demands, filters, reportType, userLabel, onClose]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0F5132, #198754, #0F5132)'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 24px' }}>
          <Spinner size={80} className="text-[#20C997]" />
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Sparkles size={28} color="#F4B400" />
          </div>
        </div>
        <p style={{ color: 'white', fontSize: 18, fontWeight: 600, letterSpacing: '0.025em' }}>{msg}</p>
      </div>
    </div>
  );
}

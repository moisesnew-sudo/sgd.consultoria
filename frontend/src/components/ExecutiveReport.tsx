import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Demand } from '../types';
import { buildReportHtml } from './reports/buildReportHtml';

interface Props {
  demands: Demand[];
  filters: { uf: string; status: string; priority: string; ano: string };
  onClose: () => void;
}

export default function ExecutiveReport({ demands, filters, onClose }: Props) {
  const [msg, setMsg] = useState('Preparando relatório...');

  useEffect(() => {
    setMsg('Processando dados...');
    const timer = setTimeout(() => {
      setMsg('Gerando documento...');
      const html = buildReportHtml(demands, filters, 'Administrador');
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (w) {
        w.onload = () => { URL.revokeObjectURL(url); };
      } else {
        URL.revokeObjectURL(url);
      }
      onClose();
    }, 600);
    return () => clearTimeout(timer);
  }, [demands, filters, onClose]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a, #1e1b4b, #0f172a)'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 24px' }}>
          <div style={{
            width: 80, height: 80,
            border: '3px solid rgba(129,140,248,0.2)',
            borderTopColor: '#818cf8',
            borderRadius: '50%',
            animation: 'rspin 1s linear infinite'
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Sparkles size={28} color="#a5b4fc" />
          </div>
        </div>
        <p style={{ color: 'white', fontSize: 18, fontWeight: 600, letterSpacing: '0.025em' }}>{msg}</p>
      </div>
      <style>{`@keyframes rspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

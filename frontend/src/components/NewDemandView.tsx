import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  MapPin, 
  DollarSign, 
  Layers, 
  CheckCircle2, 
  Printer, 
  Plus,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { Demand, DemandPriority, DemandStatus, Attachment } from '../types';
import { demandsApi } from '../services/api';
import { formatCurrencyInput, parseCurrencyInput } from '../lib/currency';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface NewDemandViewProps {
  municipalities: { name: string; uf: string }[];
  onAddDemand: (newDemand: Demand) => void;
  onNavigateToTab: (tab: string) => void;
}

const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

const CATEGORIES = [
  'Construção de Creche',
  'Transporte Escolar',
  'Reforma Estrutural',
  'Infraestrutura e Conforto',
  'Tecnologia Educacional',
  'Educação Especial',
  'Mobiliário e Parquinhos',
  'Construção e Ampliação',
  'Capacitação Docente'
];

export default function NewDemandView({ municipalities, onAddDemand, onNavigateToTab }: NewDemandViewProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Form States
  const [uf, setUf] = useState('CE');
  const [municipality, setMunicipality] = useState('');
  const [prefeitura, setPrefeitura] = useState('');
  const [proposalNumber, setProposalNumber] = useState('');
  const [objeto, setObjeto] = useState('');
  const [organ, setOrgan] = useState('');
  const [requestedValue, setRequestedValue] = useState('');
  const [status, setStatus] = useState<DemandStatus>('pendente');
  const [ano, setAno] = useState(new Date().getFullYear());
  const [processLink, setProcessLink] = useState('');
  const [description, setDescription] = useState('');
  const [responsibleName, setResponsibleName] = useState(user?.name || '');
  const [responsibleEmail, setResponsibleEmail] = useState(user?.email || '');
  const [responsiblePhone, setResponsiblePhone] = useState('');
  const [priority, setPriority] = useState<DemandPriority>('media');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [createdProtocol, setCreatedProtocol] = useState<Demand | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredMunicipalities = municipalities.filter(m => m.uf === uf);

  const handleMunicipalityChange = (val: string) => {
    const upper = val.toUpperCase();
    setMunicipality(upper);
    if (upper) {
      setPrefeitura(`Prefeitura Municipal de ${upper}`);
    } else {
      setPrefeitura('');
    }
  };

  const handleUfChange = (selectedUf: string) => {
    setUf(selectedUf);
    const firstMun = municipalities.find(m => m.uf === selectedUf);
    if (firstMun) {
      handleMunicipalityChange(firstMun.name.toUpperCase());
    } else {
      setMunicipality('');
      setPrefeitura('');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addSimulatedFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addSimulatedFiles(e.target.files);
    }
  };

  const addSimulatedFiles = (fileList: FileList) => {
    const newFiles: Attachment[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      newFiles.push({
        demand_id: '',
        name: file.name,
        size: `${sizeMB} MB`,
        type: file.type || 'application/pdf'
      });
    }
    setAttachments([...attachments, ...newFiles]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: { [key: string]: string } = {};
    if (!uf) newErrors.uf = 'Selecione a UF.';
    if (!municipality.trim()) newErrors.municipality = 'Informe o município.';
    if (!objeto.trim()) newErrors.objeto = 'Informe o objeto da demanda.';
    if (!ano || String(ano).length !== 4 || ano < 1900 || ano > 2100) newErrors.ano = 'Informe um ano válido com 4 dígitos.';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      const newDemand = await demandsApi.create({
        title: objeto,
        description: description.trim() || `Proposta de repasse sob o objeto: ${objeto}`,
        category: objeto.length > 30 ? objeto.substring(0, 30) + '...' : objeto,
        status,
        priority,
        municipality,
        uf,
        requested_value: requestedValue ? parseCurrencyInput(requestedValue) : 0,
        prefeitura: (prefeitura || `Prefeitura Municipal de ${municipality}`).toUpperCase(),
        proposal_number: proposalNumber || undefined,
        organ: organ || undefined,
        process_link: processLink.trim() || undefined,
        responsible_name: responsibleName || undefined,
        responsible_email: responsibleEmail || undefined,
        responsible_phone: responsiblePhone || undefined,
        notes: notes.trim() || undefined,
        ano: Number(ano) || undefined
      });

      onAddDemand(newDemand);
      setCreatedProtocol(newDemand);
    } catch (error: any) {
      console.error('Error creating demand:', error);
      toast('error', 'Erro ao criar demanda', error?.message || 'Tente novamente');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setUf('CE');
    setMunicipality('');
    setPrefeitura('');
    setProposalNumber('');
    setObjeto('');
    setOrgan('');
    setAno(new Date().getFullYear());
    setRequestedValue('');
    setStatus('pendente');
    setProcessLink('');
    setDescription('');
    setPriority('media');
    setNotes('');
    setAttachments([]);
    setCreatedProtocol(null);
  };

  const handlePrint = () => {
    window.print();
  };

  if (createdProtocol) {
    return (
      <div className="max-w-3xl mx-auto bg-white border border-slate-100 rounded-3xl p-6 md:p-8 shadow-xl space-y-6 animate-fade-in" id="receipt-screen">
        <div className="text-center space-y-3 pb-6 border-b border-slate-100">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600 mx-auto animate-bounce">
            <CheckCircle2 size={36} />
          </div>
          <h2 className="text-xl md:text-2xl font-black text-slate-800">
            Cadastro de Demanda Concluído!
          </h2>
          <p className="text-sm text-slate-500">
            A proposta foi inserida no sistema com o ID:
          </p>
          <div className="inline-block bg-slate-900 text-brand-300 font-mono font-bold text-lg px-4 py-2 rounded-xl border border-slate-800 shadow-xs">
            {createdProtocol.id}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-4">
          <button
            onClick={handlePrint}
            className="flex-1 py-3 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <Printer size={16} /> Imprimir Recibo
          </button>
          <button
            onClick={() => onNavigateToTab('demands')}
            className="flex-1 py-3 px-4 rounded-xl bg-brand-700 hover:bg-brand-800 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
          >
            Visualizar Demandas
          </button>
          <button
            onClick={handleResetForm}
            className="flex-1 py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <Plus size={16} /> Novo Cadastro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6" id="new-demand-view-root">
      <div>
        <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
          <FileText className="text-brand-700" size={26} />
          Cadastro Geral de Demandas
        </h2>
        <p className="text-sm text-slate-500">
          Insira novas demandas e propostas de recursos destinadas a municípios e estados.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-slate-100 rounded-3xl p-6 md:p-8 shadow-lg space-y-8">
        
        {/* Section 1: Location */}
        <div className="space-y-5">
          <h3 className="text-xs font-extrabold text-brand-700 uppercase tracking-widest border-b border-slate-100 pb-2 flex items-center gap-1.5">
            <MapPin size={16} />
            1. Origem e Localização
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-4 space-y-1" id="field-uf">
              <label htmlFor="uf-select" className="text-xs font-bold text-slate-700 block">UF (Estado) *</label>
              <select
                id="uf-select"
                value={uf}
                onChange={(e) => handleUfChange(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
              >
                {BRAZILIAN_STATES.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-8 space-y-1" id="field-municipality">
              <label htmlFor="municipality-input" className="text-xs font-bold text-slate-700 block">Município *</label>
              <input
                id="municipality-input"
                type="text"
                list="predefined-municipalities"
                value={municipality}
                onChange={(e) => handleMunicipalityChange(e.target.value)}
                placeholder="Ex: Petrolina"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent ${
                  errors.municipality ? 'border-red-400 bg-red-50/20' : 'border-slate-200'
                }`}
              />
              <datalist id="predefined-municipalities">
                {filteredMunicipalities.map((m, idx) => (
                  <option key={idx} value={m.name} />
                ))}
              </datalist>
              {errors.municipality && <p className="text-[10px] text-red-500 font-semibold">{errors.municipality}</p>}
            </div>

            <div className="md:col-span-6 space-y-1" id="field-prefeitura">
              <label htmlFor="prefeitura-input" className="text-xs font-bold text-slate-700 block">Prefeitura Solicitante</label>
              <input
                id="prefeitura-input"
                type="text"
                value={prefeitura}
                onChange={(e) => setPrefeitura(e.target.value)}
                placeholder="Ex: Prefeitura Municipal de Petrolina"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
              />
            </div>

            <div className="md:col-span-6 space-y-1" id="field-proposalNumber">
              <label htmlFor="proposalNumber-input" className="text-xs font-bold text-slate-700 block">Número da Proposta</label>
              <input
                id="proposalNumber-input"
                type="text"
                value={proposalNumber}
                onChange={(e) => setProposalNumber(e.target.value)}
                placeholder="Ex: PROP-2026-8794"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Project Details */}
        <div className="space-y-5">
          <h3 className="text-xs font-extrabold text-brand-700 uppercase tracking-widest border-b border-slate-100 pb-2 flex items-center gap-1.5">
            <Layers size={16} />
            2. Detalhes do Projeto
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-12 space-y-1" id="field-objeto">
              <label htmlFor="objeto-input" className="text-xs font-bold text-slate-700 block">Objeto / Projeto *</label>
              <input
                id="objeto-input"
                type="text"
                value={objeto}
                onChange={(e) => setObjeto(e.target.value.toUpperCase())}
                placeholder="Ex: Construção de Creche Proinfância"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent ${
                  errors.objeto ? 'border-red-400 bg-red-50/20' : 'border-slate-200'
                }`}
              />
              {errors.objeto && <p className="text-[10px] text-red-500 font-semibold">{errors.objeto}</p>}
            </div>

            <div className="md:col-span-6 space-y-1" id="field-organ">
              <label htmlFor="organ-input" className="text-xs font-bold text-slate-700 block">Órgão Destinatário</label>
              <input
                id="organ-input"
                type="text"
                value={organ}
                onChange={(e) => setOrgan(e.target.value)}
                placeholder="Ex: MEC, MS, FNDE"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent ${
                  errors.organ ? 'border-red-400 bg-red-50/20' : 'border-slate-200'
                }`}
              />
              {errors.organ && <p className="text-[10px] text-red-500 font-semibold">{errors.organ}</p>}
            </div>

            <div className="md:col-span-6 space-y-1" id="field-requestedValue">
              <label htmlFor="value-input" className="text-xs font-bold text-slate-700 block">Valor Solicitado (R$)</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold">R$</span>
                <input
                  id="value-input"
                  type="text"
                  inputMode="numeric"
                  value={requestedValue}
                  onChange={(e) => setRequestedValue(formatCurrencyInput(e.target.value))}
                  placeholder="R$ 0,00"
                  className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent ${
                    errors.requestedValue ? 'border-red-400 bg-red-50/20' : 'border-slate-200'
                  }`}
                />
              </div>
              {errors.requestedValue && <p className="text-[10px] text-red-500 font-semibold">{errors.requestedValue}</p>}
            </div>

            <div className="md:col-span-6 space-y-1" id="field-status">
              <label htmlFor="status-select" className="text-xs font-bold text-slate-700 block">Status Inicial *</label>
              <select
                id="status-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as DemandStatus)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
              >
                <option value="pendente">Pendente</option>
                <option value="analise">Em Análise</option>
                <option value="concluido">Concluído</option>
                <option value="rejeitado">Rejeitado</option>
              </select>
            </div>

            <div className="md:col-span-6 space-y-1" id="field-ano">
              <label htmlFor="ano-input" className="text-xs font-bold text-slate-700 block">Ano *</label>
              <input
                id="ano-input"
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={ano || ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setAno(val ? Number(val) : 0);
                }}
                placeholder="Ex.: 2026"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent ${
                  errors.ano ? 'border-red-400 bg-red-50/20' : 'border-slate-200'
                }`}
              />
              {errors.ano && <p className="text-[10px] text-red-500 font-semibold">{errors.ano}</p>}
            </div>

            <div className="md:col-span-6 space-y-1" id="field-processLink">
              <label htmlFor="processLink-input" className="text-xs font-bold text-slate-700 block">Link do Processo</label>
              <input
                id="processLink-input"
                type="url"
                value={processLink}
                onChange={(e) => setProcessLink(e.target.value)}
                placeholder="https://processos.governo.gov.br/..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Responsibility */}
        <div className="space-y-5">
          <h3 className="text-xs font-extrabold text-brand-700 uppercase tracking-widest border-b border-slate-100 pb-2 flex items-center gap-1.5">
            <DollarSign size={16} />
            3. Responsável e Criticidade
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label htmlFor="resp-name-input" className="text-xs font-bold text-slate-700 block">Gestor Responsável</label>
              <input
                id="resp-name-input"
                type="text"
                value={responsibleName}
                onChange={(e) => setResponsibleName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="resp-email-input" className="text-xs font-bold text-slate-700 block">E-mail de Contato</label>
              <input
                id="resp-email-input"
                type="email"
                value={responsibleEmail}
                onChange={(e) => setResponsibleEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 block">Grau de Criticidade</label>
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-50 border border-slate-200 rounded-xl">
                {(['baixa', 'media', 'alta', 'urgente'] as DemandPriority[]).map(pri => (
                  <button
                    key={pri}
                    type="button"
                    onClick={() => setPriority(pri)}
                    className={`text-[9px] font-bold uppercase py-1.5 rounded-lg text-center transition-all ${
                      priority === pri
                        ? pri === 'urgente'
                          ? 'bg-red-500 text-white shadow-xs'
                          : pri === 'alta'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : pri === 'media'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-500 text-white shadow-xs'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {pri}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* File Upload */}
          <div className="space-y-2 pt-2">
            <label className="text-xs font-bold text-slate-700 block">Anexar Documentação</label>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all flex flex-col items-center justify-center gap-3 cursor-pointer ${
                isDragging 
                  ? 'border-blue-600 bg-blue-50/30' 
                  : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50/20'
              }`}
            >
              <input
                type="file"
                id="file-upload-input"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <label htmlFor="file-upload-input" className="cursor-pointer flex flex-col items-center gap-2">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                  <FileText size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700">Arraste arquivos ou clique para selecionar</p>
                  <p className="text-[10px] text-slate-400 mt-1">PDF, DOCX, XLSX. Máx: 15MB</p>
                </div>
              </label>
            </div>
          </div>

          {attachments.length > 0 && (
            <div className="space-y-2 bg-slate-50/50 p-4 border border-slate-100 rounded-2xl">
              <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Arquivos ({attachments.length})</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {attachments.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-white border border-slate-200/60 rounded-xl shadow-xs">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 font-bold text-[9px] uppercase font-mono">
                        {file.name.split('.').pop() || 'PDF'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate" title={file.name}>{file.name}</p>
                        <p className="text-[9px] text-slate-400 font-mono">{file.size}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <label htmlFor="notes-textarea" className="text-xs font-bold text-slate-700 block">Observações (Opcional)</label>
          <textarea
            id="notes-textarea"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anotações internas..."
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
          />
        </div>

        {/* Submit */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pt-6 border-t border-slate-100">
          <button
            type="button"
            onClick={() => onNavigateToTab('dashboard')}
            className="py-3 px-6 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="py-3 px-8 rounded-xl bg-brand-700 hover:bg-brand-800 text-white font-bold text-xs uppercase tracking-wider shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Cadastrando...
              </>
            ) : (
              'Cadastrar Demanda'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
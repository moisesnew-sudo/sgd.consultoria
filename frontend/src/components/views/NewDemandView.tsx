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
  AlertCircle,
  User,
  Paperclip,
  MessageSquare,
  Save,
  Clock,
  Phone,
  X,
  Check,
  RotateCcw
} from 'lucide-react';
import { Demand, DemandPriority, DemandStatus, Attachment } from '../../types';
import { demandsApi } from '../../services/api';
import { formatCurrencyInput, parseCurrencyInput } from '../../lib/currency';
import { STATUS_BADGE_CLS, statusLabel, BRAZILIAN_STATES } from '../../lib/demandMeta';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

interface NewDemandViewProps {
  municipalities: { name: string; uf: string }[];
  onAddDemand: (newDemand: Demand) => void;
  onNavigateToTab: (tab: string) => void;
}

const ORGAN_OPTIONS = [
  'MEC', 'FNDE', 'MEC/FNDE', 'MINISTÉRIO DA SAÚDE', 'MS', 'MAPA',
  'MINISTÉRIO DA AGRICULTURA E PECUÁRIA', 'SECRETARIA MUNICIPAL DE EDUCAÇÃO',
  'SECRETARIA ESTADUAL DE EDUCAÇÃO', 'CAIXA ECONÔMICA FEDERAL', 'BNDES',
  'CONSELHO MUNICIPAL DE EDUCAÇÃO'
];

const PRIORITIES: { value: DemandPriority; label: string; active: string }[] = [
  { value: 'baixa', label: 'Baixa', active: 'bg-slate-500 text-white shadow-xs' },
  { value: 'media', label: 'Média', active: 'bg-blue-600 text-white shadow-xs' },
  { value: 'alta', label: 'Alta', active: 'bg-amber-500 text-white shadow-xs' },
  { value: 'urgente', label: 'Urgente', active: 'bg-red-500 text-white shadow-xs' }
];

const DRAFT_KEY = 'sgd_demand_draft_v1';

type LocalAttachment = Attachment & { addedAt: string };

interface DraftPayload {
  uf: string;
  municipality: string;
  prefeitura: string;
  proposalNumber: string;
  objeto: string;
  organ: string;
  requestedValue: string;
  status: DemandStatus;
  ano: number;
  processLink: string;
  responsibleName: string;
  responsibleEmail: string;
  responsiblePhone: string;
  priority: DemandPriority;
  notes: string;
  attachments: LocalAttachment[];
  savedAt: string;
}

function Field({
  label,
  required,
  error,
  hint,
  children,
  className = ''
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
        {label} {required && <span className="text-red-500" title="Campo obrigatório">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[10px] text-red-500 font-semibold flex items-center gap-1 animate-fade-in">
          <AlertCircle size={11} className="shrink-0" /> {error}
        </p>
      ) : hint ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  iconClass,
  children
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconClass: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 md:p-6 shadow-sm space-y-5 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-black text-slate-800 dark:text-white">{title}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const inputCls = (hasError: boolean) =>
  `w-full px-3.5 py-2.5 rounded-xl border text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900/60 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent transition-colors ${
    hasError ? 'border-red-400 bg-red-50/20 dark:bg-red-950/20' : 'border-slate-200 dark:border-slate-700'
  }`;

const selectCls =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900/60 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent transition-colors';

const formatPhoneInput = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const formatDateTime = (d: Date) =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
  ' ' +
  d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

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
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [createdProtocol, setCreatedProtocol] = useState<Demand | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [lastEdited, setLastEdited] = useState<Date | null>(null);

  const filteredMunicipalities = municipalities.filter(m => m.uf === uf);

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as DraftPayload;
      setUf(d.uf || 'CE');
      setMunicipality(d.municipality || '');
      setPrefeitura(d.prefeitura || '');
      setProposalNumber(d.proposalNumber || '');
      setObjeto(d.objeto || '');
      setOrgan(d.organ || '');
      setRequestedValue(d.requestedValue || '');
      setStatus(d.status || 'pendente');
      setAno(d.ano || new Date().getFullYear());
      setProcessLink(d.processLink || '');
      setResponsibleName(d.responsibleName || '');
      setResponsibleEmail(d.responsibleEmail || '');
      setResponsiblePhone(d.responsiblePhone || '');
      setPriority(d.priority || 'media');
      setNotes(d.notes || '');
      setAttachments(d.attachments || []);
      setHasDraft(true);
      setLastEdited(d.savedAt ? new Date(d.savedAt) : new Date());
      toast('info', 'Rascunho restaurado', 'Dados salvos anteriormente foram recuperados.');
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track last edit timestamp
  useEffect(() => {
    setLastEdited(new Date());
  }, [
    uf, municipality, prefeitura, proposalNumber, objeto, organ, requestedValue, status, ano,
    processLink, responsibleName, responsibleEmail, responsiblePhone, priority, notes, attachments
  ]);

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

  // ---- Validation ----
  const validateField = (field: string, v?: string): string | undefined => {
    switch (field) {
      case 'uf':
        return (v ?? uf) ? undefined : 'Selecione a UF.';
      case 'municipality':
        return (v ?? municipality).trim() ? undefined : 'Informe o município.';
      case 'objeto':
        return (v ?? objeto).trim() ? undefined : 'Informe o objeto da demanda.';
      case 'ano': {
        const val = v !== undefined ? Number(v) : ano;
        return (!val || String(val).length !== 4 || val < 1900 || val > 2100)
          ? 'Informe um ano válido com 4 dígitos.'
          : undefined;
      }
      case 'responsibleEmail': {
        const val = (v ?? responsibleEmail).trim();
        return (!val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) ? undefined : 'Informe um e-mail válido.';
      }
      case 'responsiblePhone': {
        const val = (v ?? responsiblePhone).trim();
        return (!val || val.replace(/\D/g, '').length >= 10) ? undefined : 'Telefone incompleto (ex.: (85) 99999-9999).';
      }
      default:
        return undefined;
    }
  };

  const revalidate = (field: string, value?: string) => {
    setErrors(prev => {
      if (!prev[field]) return prev;
      const err = validateField(field, value);
      const next = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  };

  const handleBlur = (field: string) => {
    const err = validateField(field);
    setErrors(prev => {
      const next = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  };

  const makeTextHandler = (
    setter: (v: string) => void,
    field: string,
    toUpper = false
  ) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = toUpper ? e.target.value.toUpperCase() : e.target.value;
    setter(val);
    revalidate(field, val);
  };

  // ---- Attachments ----
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
    const newFiles: LocalAttachment[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      newFiles.push({
        demand_id: '',
        name: file.name,
        size: `${sizeMB} MB`,
        type: file.type || 'application/pdf',
        addedAt: new Date().toLocaleDateString('pt-BR')
      });
    }
    setAttachments([...attachments, ...newFiles]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  // ---- Draft (localStorage) ----
  const saveDraft = () => {
    try {
      const payload: DraftPayload = {
        uf, municipality, prefeitura, proposalNumber, objeto, organ, requestedValue, status,
        ano, processLink, responsibleName, responsibleEmail, responsiblePhone, priority, notes,
        attachments, savedAt: new Date().toISOString()
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      setHasDraft(true);
      toast('success', 'Rascunho salvo', 'Seus dados ficaram salvos neste navegador.');
    } catch {
      toast('error', 'Erro ao salvar rascunho', 'Não foi possível salvar neste navegador.');
    }
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
    handleResetForm();
    toast('info', 'Rascunho descartado');
  };

  // ---- Submit ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: { [key: string]: string } = {};
    ['uf', 'municipality', 'objeto', 'ano', 'responsibleEmail', 'responsiblePhone'].forEach(f => {
      const err = validateField(f);
      if (err) newErrors[f] = err;
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      const newDemand = await demandsApi.create({
        title: objeto,
        description: (description.trim() || `Proposta de repasse sob o objeto: ${objeto}`).toUpperCase(),
        category: (objeto.length > 30 ? objeto.substring(0, 30) + '...' : objeto).toUpperCase(),
        status,
        priority,
        municipality,
        uf,
        requested_value: requestedValue ? parseCurrencyInput(requestedValue) : 0,
        prefeitura: (prefeitura || `Prefeitura Municipal de ${municipality}`).toUpperCase(),
        proposal_number: proposalNumber?.trim().toUpperCase() || undefined,
        organ: organ?.trim().toUpperCase() || undefined,
        process_link: processLink.trim() || undefined,
        responsible_name: responsibleName?.trim().toUpperCase() || undefined,
        responsible_email: responsibleEmail?.trim().toLowerCase() || undefined,
        responsible_phone: responsiblePhone?.trim() || undefined,
        notes: notes.trim().toUpperCase() || undefined,
        ano: Number(ano) || undefined
      });

      localStorage.removeItem(DRAFT_KEY);
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
    setResponsiblePhone('');
    setAttachments([]);
    setErrors({});
    setHasDraft(false);
    setLastEdited(null);
    setCreatedProtocol(null);
  };

  const handlePrint = () => {
    window.print();
  };

  // ---- Progress ----
  const STEP_DEFS = [
    { id: 'origem', label: 'Origem', total: 3 },
    { id: 'projeto', label: 'Projeto', total: 3 },
    { id: 'responsavel', label: 'Responsável', total: 3 },
    { id: 'recursos', label: 'Recursos', total: 1 },
    { id: 'revisao', label: 'Revisão', total: 2 }
  ];

  const stepFilled: Record<string, number> = {
    origem: [municipality.trim(), prefeitura.trim(), proposalNumber.trim()].filter(Boolean).length,
    projeto: [objeto.trim(), organ.trim(), processLink.trim()].filter(Boolean).length,
    responsavel: [responsibleName.trim(), responsibleEmail.trim(), responsiblePhone.trim()].filter(Boolean).length,
    recursos: requestedValue.trim() ? 1 : 0,
    revisao: (notes.trim() ? 1 : 0) + (attachments.length > 0 ? 1 : 0)
  };

  const totalFilled = STEP_DEFS.reduce((sum, s) => sum + stepFilled[s.id], 0);
  const totalFields = STEP_DEFS.reduce((sum, s) => sum + s.total, 0);
  const progressPct = Math.round((totalFilled / totalFields) * 100);
  const stepsDone = STEP_DEFS.map(s => stepFilled[s.id] >= s.total);

  if (createdProtocol) {
    return (
      <div className="max-w-3xl mx-auto bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-3xl p-6 md:p-8 shadow-xl space-y-6 animate-fade-in" id="receipt-screen">
        <div className="text-center space-y-3 pb-6 border-b border-slate-100 dark:border-slate-700/50">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-950/40 rounded-full flex items-center justify-center text-green-600 dark:text-green-400 mx-auto animate-bounce">
            <CheckCircle2 size={36} />
          </div>
          <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white">
            Cadastro de Demanda Concluído!
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            A proposta foi inserida no sistema com o ID:
          </p>
          <div className="inline-block bg-slate-900 text-brand-300 font-mono font-bold text-lg px-4 py-2 rounded-xl border border-slate-800 shadow-xs">
            {createdProtocol.id}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-4">
          <button
            onClick={handlePrint}
            className="flex-1 py-3 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
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
            className="flex-1 py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <Plus size={16} /> Novo Cadastro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6" id="new-demand-view-root">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* STICKY HEADER */}
        <div className="sticky top-0 z-40 -mx-4 md:-mx-8 px-4 md:px-8 pt-4 pb-3 bg-slate-50/95 dark:bg-[#0a1628]/95 backdrop-blur-xl border-b border-slate-200/70 dark:border-slate-800 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="text-brand-700 dark:text-brand-400" size={26} />
                Nova Demanda
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Cadastre uma nova proposta de forma organizada e padronizada.
              </p>
            </div>            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigateToTab('dashboard')}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs uppercase tracking-wider cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveDraft}
                className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center gap-2 cursor-pointer"
              >
                <Save size={14} /> Salvar Rascunho
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Cadastrando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Salvar Demanda
                  </>
                )}
              </button>
            </div>
          </div>

          {/* PROGRESS */}
          <div className="mt-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-600 to-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-[10px] font-black text-brand-700 dark:text-brand-300 tabular-nums">{progressPct}%</span>
            </div>
            <div className="flex items-center justify-between gap-2 mt-2.5 overflow-x-auto custom-scrollbar">
              {STEP_DEFS.map((s, i) => {
                const done = stepsDone[i];
                const isCurrent = !done && (i === 0 || stepsDone[i - 1]);
                return (
                  <React.Fragment key={s.id}>
                    {i > 0 && (
                      <div className={`flex-1 h-0.5 rounded-full min-w-[8px] mx-1 transition-colors ${stepsDone[i - 1] ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`} />
                    )}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                          done
                            ? 'bg-emerald-500 text-white'
                            : isCurrent
                            ? 'bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-900/40'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                        }`}
                      >
                        {done ? <Check size={11} strokeWidth={3} /> : <span className="text-[9px] font-black">{i + 1}</span>}
                      </span>
                      <span
                        className={`text-[10px] font-bold whitespace-nowrap ${
                          done
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isCurrent
                            ? 'text-brand-700 dark:text-brand-300'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {s.label}
                      </span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        {hasDraft && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 text-xs text-sky-700 dark:text-sky-300 animate-fade-in">
            <Save size={14} className="shrink-0" />
            <span className="font-semibold">Rascunho restaurado deste navegador.</span>
            <button
              type="button"
              onClick={discardDraft}
              className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} /> Descartar
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          {/* MAIN COLUMN */}
          <div className="space-y-6 min-w-0">
            {/* CARD 1: Origem e Localização */}
            <SectionCard
              icon={<MapPin size={20} className="text-blue-600 dark:text-blue-400" />}
              title="Origem e Localização"
              description="Identifique a origem da proposta e sua localização."
              iconClass="bg-blue-50 dark:bg-blue-950/40"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Field label="UF" required error={errors.uf}>
                  <select
                    id="uf-select"
                    value={uf}
                    onChange={(e) => handleUfChange(e.target.value)}
                    className={selectCls}
                  >
                    {BRAZILIAN_STATES.map(state => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Município" required error={errors.municipality}>
                  <input
                    id="municipality-input"
                    type="text"
                    list="predefined-municipalities"
                    value={municipality}
                    onChange={(e) => handleMunicipalityChange(e.target.value)}
                    onBlur={() => handleBlur('municipality')}
                    placeholder="Ex: Petrolina"
                    className={inputCls(!!errors.municipality)}
                  />
                  <datalist id="predefined-municipalities">
                    {filteredMunicipalities.map((m, idx) => (
                      <option key={idx} value={m.name} />
                    ))}
                  </datalist>
                </Field>

                <Field label="Prefeitura Solicitante" hint="Preenchida automaticamente pelo município.">
                  <input
                    id="prefeitura-input"
                    type="text"
                    value={prefeitura}
                    onChange={makeTextHandler(setPrefeitura, 'prefeitura', true)}
                    placeholder="Ex: Prefeitura Municipal de Petrolina"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="Número da Proposta" hint="Identificador da proposta (ex.: PROP-2026-8794).">
                  <input
                    id="proposalNumber-input"
                    type="text"
                    value={proposalNumber}
                    onChange={makeTextHandler(setProposalNumber, 'proposalNumber', true)}
                    placeholder="Ex: PROP-2026-8794"
                    className={inputCls(false)}
                  />
                </Field>
              </div>
            </SectionCard>

            {/* CARD 2: Projeto */}
            <SectionCard
              icon={<Layers size={20} className="text-blue-600 dark:text-blue-400" />}
              title="Projeto"
              description="Descreva o objeto da proposta e os detalhes do projeto."
              iconClass="bg-blue-50 dark:bg-blue-950/40"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Field label="Objeto / Projeto" required error={errors.objeto} className="sm:col-span-2">
                  <input
                    id="objeto-input"
                    type="text"
                    value={objeto}
                    onChange={makeTextHandler(setObjeto, 'objeto', true)}
                    onBlur={() => handleBlur('objeto')}
                    placeholder="Ex: Construção de Creche Proinfância"
                    className={inputCls(!!errors.objeto)}
                  />
                </Field>

                <Field label="Órgão Destinatário">
                  <input
                    id="organ-input"
                    type="text"
                    list="organ-options"
                    value={organ}
                    onChange={makeTextHandler(setOrgan, 'organ', true)}
                    placeholder="Ex: MEC, FNDE, MS"
                    className={inputCls(false)}
                  />
                  <datalist id="organ-options">
                    {ORGAN_OPTIONS.map(o => <option key={o} value={o} />)}
                  </datalist>
                </Field>

                <Field label="Status Inicial" required>
                  <select
                    id="status-select"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as DemandStatus)}
                    className={selectCls}
                  >
                    <option value="pendente">Pendente</option>
                    <option value="analise">Em Análise</option>
                    <option value="concluido">Concluído</option>
                    <option value="rejeitado">Rejeitado</option>
                  </select>
                </Field>

                <Field label="Ano" required error={errors.ano}>
                  <input
                    id="ano-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={ano || ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setAno(val ? Number(val) : 0);
                      revalidate('ano', val);
                    }}
                    onBlur={() => handleBlur('ano')}
                    placeholder="Ex.: 2026"
                    className={inputCls(!!errors.ano)}
                  />
                </Field>

                <Field label="Link do Processo">
                  <input
                    id="processLink-input"
                    type="url"
                    value={processLink}
                    onChange={makeTextHandler(setProcessLink, 'processLink')}
                    placeholder="https://processos.governo.gov.br/..."
                    className={inputCls(false)}
                  />
                </Field>
              </div>
            </SectionCard>

            {/* CARD 3: Responsável */}
            <SectionCard
              icon={<User size={20} className="text-emerald-600 dark:text-emerald-400" />}
              title="Responsável"
              description="Quem será o gestor e responsável pela proposta."
              iconClass="bg-emerald-50 dark:bg-emerald-950/40"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Field label="Gestor Responsável">
                  <input
                    id="resp-name-input"
                    type="text"
                    value={responsibleName}
                    onChange={makeTextHandler(setResponsibleName, 'responsibleName', true)}
                    placeholder="Ex: MARIA DA SILVA"
                    className={inputCls(false)}
                  />
                </Field>

                <Field label="E-mail de Contato" error={errors.responsibleEmail}>
                  <input
                    id="resp-email-input"
                    type="email"
                    value={responsibleEmail}
                    onChange={makeTextHandler(setResponsibleEmail, 'responsibleEmail')}
                    onBlur={() => handleBlur('responsibleEmail')}
                    placeholder="Ex: gestor@municipio.gov.br"
                    className={inputCls(!!errors.responsibleEmail)}
                  />
                </Field>

                <Field label="Telefone" error={errors.responsiblePhone}>
                  <div className="relative">
                    <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="resp-phone-input"
                      type="tel"
                      inputMode="tel"
                      value={responsiblePhone}
                      onChange={(e) => {
                        const val = formatPhoneInput(e.target.value);
                        setResponsiblePhone(val);
                        revalidate('responsiblePhone', val);
                      }}
                      onBlur={() => handleBlur('responsiblePhone')}
                      placeholder="(85) 99999-9999"
                      className={`${inputCls(!!errors.responsiblePhone)} pl-9`}
                    />
                  </div>
                </Field>

                <Field label="Grau de Criticidade">
                  <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
                    {PRIORITIES.map(pri => (
                      <button
                        key={pri.value}
                        type="button"
                        onClick={() => setPriority(pri.value)}
                        className={`text-[9px] font-bold uppercase py-2 rounded-lg text-center transition-all cursor-pointer ${
                          priority === pri.value
                            ? pri.active
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {pri.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </SectionCard>

            {/* CARD 4: Recursos Financeiros */}
            <SectionCard
              icon={<DollarSign size={20} className="text-emerald-600 dark:text-emerald-400" />}
              title="Recursos Financeiros"
              description="Informe o valor solicitado para a proposta."
              iconClass="bg-emerald-50 dark:bg-emerald-950/40"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Field
                  label="Valor Solicitado (R$)"
                  error={errors.requestedValue}
                  hint="Digite apenas números; o formato monetário é aplicado automaticamente."
                >
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold">R$</span>
                    <input
                      id="value-input"
                      type="text"
                      inputMode="numeric"
                      value={requestedValue}
                      onChange={(e) => setRequestedValue(formatCurrencyInput(e.target.value))}
                      placeholder="R$ 0,00"
                      className={`${inputCls(!!errors.requestedValue)} pl-9`}
                    />
                  </div>
                </Field>
              </div>
            </SectionCard>

            {/* CARD 5: Observações */}
            <SectionCard
              icon={<MessageSquare size={20} className="text-slate-500 dark:text-slate-400" />}
              title="Observações"
              description="Anotações adicionais sobre a demanda (opcional)."
              iconClass="bg-slate-100 dark:bg-slate-800"
            >
              <div className="space-y-1.5">
                <textarea
                  id="notes-textarea"
                  rows={5}
                  value={notes}
                  onChange={makeTextHandler(setNotes, 'notes', true)}
                  placeholder="Anotações internas, detalhes do processo, justificativas..."
                  className={`${inputCls(false)} resize-y min-h-[110px]`}
                />
                <p className="text-[10px] text-slate-400 dark:text-slate-500 text-right font-medium tabular-nums">
                  {notes.length} caractere{notes.length === 1 ? '' : 's'}
                </p>
              </div>
            </SectionCard>

            {/* CARD 6: Anexos */}
            <SectionCard
              icon={<Paperclip size={20} className="text-blue-600 dark:text-blue-400" />}
              title="Anexos"
              description="Documentos comprobatórios da proposta."
              iconClass="bg-blue-50 dark:bg-blue-950/40"
            >
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all flex flex-col items-center justify-center gap-3 cursor-pointer ${
                  isDragging
                    ? 'border-brand-600 bg-brand-50/30 dark:bg-brand-950/30'
                    : 'border-slate-200 dark:border-slate-700 hover:border-brand-400 hover:bg-slate-50/20 dark:hover:bg-slate-800/30'
                }`}
              >
                <input
                  type="file"
                  id="file-upload-input"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label htmlFor="file-upload-input" className="cursor-pointer flex flex-col items-center gap-2.5">
                  <div className="w-14 h-14 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center">
                    <Paperclip size={26} className="rotate-45" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Arraste arquivos ou clique para selecionar</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">PDF, DOCX, XLSX e imagens (JPG/PNG). Máx: 15MB por arquivo.</p>
                  </div>
                </label>
              </div>

              {attachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Arquivos ({attachments.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {attachments.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 p-3 bg-slate-50/60 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 rounded-xl shadow-xs animate-fade-in">
                        <div className="min-w-0 flex-1 flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0 font-bold text-[9px] uppercase font-mono">
                            {file.name.split('.').pop() || 'PDF'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate" title={file.name}>{file.name}</p>
                            <p className="text-[9px] text-slate-400 dark:text-slate-500 font-mono flex items-center gap-1.5">
                              <span>{file.size}</span>
                              <span className="inline-flex items-center gap-0.5"><Clock size={9} /> {file.addedAt}</span>
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          aria-label={`Remover ${file.name}`}
                          title="Remover arquivo"
                          className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>
          </div>

          {/* SIDEBAR: Resumo */}
          <aside className="xl:sticky xl:top-[132px] self-start w-full">
            <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-950/40 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0">
                  <FileText size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-slate-800 dark:text-white">Resumo da Demanda</h3>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                    Atualiza em tempo real
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Número</p>
                  <p className="text-xs font-black text-slate-800 dark:text-white font-mono truncate" title={proposalNumber}>
                    {proposalNumber || 'Será gerado ao salvar'}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Município / UF</p>
                  <p className="text-xs font-black text-slate-800 dark:text-white truncate">
                    {municipality ? `${municipality} - ${uf}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</p>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] font-bold ${STATUS_BADGE_CLS[status]}`}>
                    {statusLabel(status)}
                  </span>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Valor</p>
                  <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                    {requestedValue ? `R$ ${requestedValue}` : 'R$ 0,00'}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Responsável</p>
                  <p className="text-xs font-black text-slate-800 dark:text-white truncate">
                    {responsibleName || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Anexos</p>
                  <p className="text-xs font-black text-slate-800 dark:text-white">
                    {attachments.length} arquivo{attachments.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700/50">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1">
                    <Clock size={10} /> Última alteração
                  </p>
                  <p className="text-xs font-black text-slate-800 dark:text-white tabular-nums">
                    {lastEdited ? formatDateTime(lastEdited) : '—'}
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}

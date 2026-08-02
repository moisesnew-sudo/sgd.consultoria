import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Grid, 
  List as ListIcon, 
  X, 
  ExternalLink, 
  AlertCircle, 
  User, 
  Phone, 
  Mail, 
  FileText, 
  Paperclip, 
  Plus, 
  CornerDownRight, 
  Printer,
  Edit2,
  FolderKanban,
  ShieldCheck,
  Loader2,
  Trash2,
  MessageSquare,
  Send,
  Eye,
  History,
  MapPin,
  Pencil,
  SlidersHorizontal,
  FilePlus2,
  Check,
  FilterX,
  DollarSign,
  Building2
} from 'lucide-react';
import { Demand, DemandStatus, DemandPriority, TimelineEvent, PaginatedResponse } from '../../types';
import { demandsApi, formatCurrency, formatDate } from '../../services/api';
import { formatCurrencyInput, parseCurrencyInput } from '../../lib/currency';
import { statusLabel } from '../../lib/demandMeta';
import { StatusBadge, PriorityBadge, PageHeader, SummaryCard, EmptyState, FiltersDrawer, Select, Input } from '../ui';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { TableSkeleton } from '../ui/Skeleton';
import { lazy, Suspense, useMemo } from 'react';
import { Sparkles, BrainCircuit } from 'lucide-react';
import { summarizeDemand, suggestPriority, findSimilar, parseNaturalLanguage } from '../../lib/ai';
const ImportExportBar = lazy(() => import('../shared/ImportExportBar'));
import DemandHistory from '../shared/DemandHistory';

interface DemandsViewProps {
  demands: Demand[];
  selectedDemandFromDashboard: Demand | null;
  clearSelectedDemandFromDashboard: () => void;
  onUpdateDemand: (updated: Demand) => void;
  onAddDemand?: (newDemand: Demand) => void;
  onDeleteDemand?: (id: string) => void;
  isLoading: boolean;
  onNavigateToTab?: (tab: string) => void;
}

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

export default function DemandsView({ 
  demands, 
  selectedDemandFromDashboard, 
  clearSelectedDemandFromDashboard, 
  onUpdateDemand,
  onAddDemand,
  onDeleteDemand,
  isLoading,
  onNavigateToTab
}: DemandsViewProps) {
  const { user, isAuthenticated, hasPermission } = useAuth();
  const { toast } = useToast();
  const canEdit = hasPermission('demands.edit');
  const canDelete = hasPermission('demands.delete');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canCreate = hasPermission('demands.create');
  const canExportExcel = hasPermission('demands.export_excel');
  const canExportPdf = hasPermission('demands.export_pdf');
  
  // Search & Filters State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [ufFilter, setUfFilter] = useState<string>('all');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('all');
  const [anoFilter, setAnoFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [valueMin, setValueMin] = useState('');
  const [valueMax, setValueMax] = useState('');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [nlQuery, setNlQuery] = useState('');
  const [nlExplanation, setNlExplanation] = useState('');

  // Filter drawer (draft applied on "Aplicar")
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [draft, setDraft] = useState<{
    status: string; priority: string; category: string; uf: string;
    responsible: string; ano: string; dateFrom: string; dateTo: string;
    valueMin: string; valueMax: string; sortBy: string;
  } | null>(null);

  // View Mode
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');

  // Selected Demand Detail Modal
  const [detailedDemand, setDetailedDemand] = useState<Demand | null>(null);

  // New Event Form State
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventStatus, setNewEventStatus] = useState<string>('no-change');
  const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);

  // Edit notes state
  const [adminNotes, setAdminNotes] = useState('');

  const [newComment, setNewComment] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  // Upload state
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !detailedDemand) return;
    setUploadingAttachments(true);
    try {
      const uploaded = await demandsApi.uploadAttachments(detailedDemand.id, Array.from(files));
      setDetailedDemand({
        ...detailedDemand,
        attachments: [...(detailedDemand.attachments || []), ...uploaded]
      });
      toast('success', 'Upload concluído', `${uploaded.length} arquivo(s) anexado(s)`);
    } catch (error: any) {
      toast('error', 'Erro no upload', error?.message || 'Erro ao enviar arquivos');
    } finally {
      setUploadingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    try {
      await demandsApi.deleteAttachment(attachmentId);
      setDetailedDemand({
        ...detailedDemand!,
        attachments: (detailedDemand!.attachments || []).filter(a => a.id !== attachmentId)
      });
      toast('success', 'Anexo removido');
    } catch (error: any) {
      toast('error', 'Erro ao remover', error?.message || 'Erro ao remover anexo');
    }
  };

  // Edit demand state
  const [isEditingDemand, setIsEditingDemand] = useState(false);
  const [detailTab, setDetailTab] = useState('timeline');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<DemandStatus>('pendente');
  const [editPriority, setEditPriority] = useState<DemandPriority>('media');
  const [editMunicipality, setEditMunicipality] = useState('');
  const [editUf, setEditUf] = useState('');
  const [editRequestedValue, setEditRequestedValue] = useState('');
  const [editOrgan, setEditOrgan] = useState('');
  const [editPrefeitura, setEditPrefeitura] = useState('');
  const [editProposalNumber, setEditProposalNumber] = useState('');
  const [editProcessLink, setEditProcessLink] = useState('');
  const [editResponsibleName, setEditResponsibleName] = useState('');
  const [editResponsibleEmail, setEditResponsibleEmail] = useState('');
  const [editResponsiblePhone, setEditResponsiblePhone] = useState('');
  const [editAno, setEditAno] = useState<number | undefined>(undefined);
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Auto-open demand if selected from dashboard
  useEffect(() => {
    if (selectedDemandFromDashboard) {
      setDetailedDemand(selectedDemandFromDashboard);
      setAdminNotes(selectedDemandFromDashboard.notes || '');
      clearSelectedDemandFromDashboard();
    }
  }, [selectedDemandFromDashboard, clearSelectedDemandFromDashboard]);

  // Handle detailed demand opening
  const handleOpenDetail = (demand: Demand) => {
    setDetailedDemand(demand);
    setAdminNotes(demand.notes || '');
    setNewEventTitle('');
    setNewEventDesc('');
    setNewEventStatus('no-change');
    setIsEditingNotes(false);
    setIsEditingDemand(false);
  };

  const handleStartEdit = (demand: Demand) => {
    setEditTitle(demand.title);
    setEditDescription(demand.description || '');
    setEditStatus(demand.status);
    setEditPriority(demand.priority);
    setEditMunicipality(demand.municipality);
    setEditUf(demand.uf);
    setEditRequestedValue(formatCurrencyInput(String(Math.round((demand.requested_value || 0) * 100))));
    setEditOrgan(demand.organ || '');
    setEditPrefeitura(demand.prefeitura || '');
    setEditProposalNumber(demand.proposal_number || '');
    setEditProcessLink(demand.process_link || '');
    setEditResponsibleName(demand.responsible_name || '');
    setEditResponsibleEmail(demand.responsible_email || '');
    setEditResponsiblePhone(demand.responsible_phone || '');
    setEditNotes(demand.notes || '');
    setEditAno(demand.ano ?? new Date().getFullYear());
    setIsEditingDemand(true);
  };

  const handleQuickEdit = (demand: Demand) => {
    handleOpenDetail(demand);
    handleStartEdit(demand);
  };

  const handleOpenHistory = (demand: Demand) => {
    handleOpenDetail(demand);
    setDetailTab('history');
  };

  const handleSaveEdit = async () => {
    if (!detailedDemand || !editTitle.trim() || !editMunicipality.trim()) return;
    setIsSavingEdit(true);
    try {
      const updated = await demandsApi.update(detailedDemand.id, {
        title: editTitle.trim().toUpperCase(),
        description: editDescription.trim().toUpperCase(),
        status: editStatus,
        priority: editPriority,
        municipality: editMunicipality.trim().toUpperCase(),
        uf: editUf,
        requested_value: editRequestedValue ? parseCurrencyInput(editRequestedValue) : 0,
        organ: editOrgan.trim().toUpperCase() || undefined,
        prefeitura: editPrefeitura.trim().toUpperCase() || undefined,
        proposal_number: editProposalNumber.trim().toUpperCase() || undefined,
        process_link: editProcessLink.trim() || undefined,
        responsible_name: editResponsibleName.trim().toUpperCase() || undefined,
        responsible_email: editResponsibleEmail.trim().toLowerCase() || undefined,
        responsible_phone: editResponsiblePhone.trim() || undefined,
        notes: editNotes.trim().toUpperCase() || undefined,
        ano: editAno
      });
      onUpdateDemand(updated);
      setDetailedDemand(updated);
      setIsEditingDemand(false);
      toast('success', 'Demanda atualizada');
    } catch (err: any) {
      toast('error', 'Erro ao salvar', err?.message || 'Tente novamente');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // List of unique UFs and responsibles
  const uniqueUfs = Array.from(new Set(demands.map(d => d.uf))).sort();
  const uniqueResponsibles = Array.from(
    new Set(demands.map(d => d.responsible_name).filter(Boolean))
  ).sort();

  const runSmartSearch = () => {
    const q = nlQuery.trim();
    if (!q) return;
    const spec = parseNaturalLanguage(q);
    setSearch(spec.search);
    if (spec.status) setStatusFilter(spec.status);
    if (spec.priority) setPriorityFilter(spec.priority);
    if (spec.uf) setUfFilter(spec.uf);
    if (spec.minValue !== undefined) setValueMin(String(spec.minValue));
    if (spec.maxValue !== undefined) setValueMax(String(spec.maxValue));
    setDraft(d => d ? {
      ...d,
      status: spec.status || d.status,
      priority: spec.priority || d.priority,
      uf: spec.uf || d.uf,
      valueMin: spec.minValue !== undefined ? String(spec.minValue) : d.valueMin,
      valueMax: spec.maxValue !== undefined ? String(spec.maxValue) : d.valueMax,
    } : d);
    setNlExplanation(spec.explanation);
  };

  const openFilters = () => {
    setDraft({
      status: statusFilter,
      priority: priorityFilter,
      category: categoryFilter,
      uf: ufFilter,
      responsible: responsibleFilter,
      ano: anoFilter,
      dateFrom,
      dateTo,
      valueMin,
      valueMax,
      sortBy,
    });
    setIsFiltersOpen(true);
  };

  const closeFilters = () => {
    setIsFiltersOpen(false);
    setDraft(null);
  };

  const applyFilters = () => {
    if (!draft) return;
    setStatusFilter(draft.status);
    setPriorityFilter(draft.priority);
    setCategoryFilter(draft.category);
    setUfFilter(draft.uf);
    setResponsibleFilter(draft.responsible);
    setAnoFilter(draft.ano);
    setDateFrom(draft.dateFrom);
    setDateTo(draft.dateTo);
    setValueMin(draft.valueMin);
    setValueMax(draft.valueMax);
    setSortBy(draft.sortBy);
    closeFilters();
  };

  const clearAllFilters = () => {
    setSearch(''); setStatusFilter('all'); setPriorityFilter('all');
    setCategoryFilter('all'); setUfFilter('all'); setResponsibleFilter('all');
    setAnoFilter('all'); setDateFrom(''); setDateTo(''); setValueMin(''); setValueMax('');
  };

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) + (priorityFilter !== 'all' ? 1 : 0) +
    (categoryFilter !== 'all' ? 1 : 0) + (ufFilter !== 'all' ? 1 : 0) +
    (responsibleFilter !== 'all' ? 1 : 0) + (anoFilter !== 'all' ? 1 : 0) +
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (valueMin ? 1 : 0) + (valueMax ? 1 : 0);

  const activeChips: { id: string; label: string; onRemove: () => void }[] = [];
  if (search.trim()) activeChips.push({ id: 'search', label: `Busca: ${search.trim()}`, onRemove: () => setSearch('') });
  if (statusFilter !== 'all') activeChips.push({ id: 'status', label: `Status: ${statusFilter}`, onRemove: () => setStatusFilter('all') });
  if (priorityFilter !== 'all') activeChips.push({ id: 'priority', label: `Prioridade: ${priorityFilter}`, onRemove: () => setPriorityFilter('all') });
  if (categoryFilter !== 'all') activeChips.push({ id: 'category', label: `Categoria: ${categoryFilter}`, onRemove: () => setCategoryFilter('all') });
  if (ufFilter !== 'all') activeChips.push({ id: 'uf', label: `UF: ${ufFilter}`, onRemove: () => setUfFilter('all') });
  if (responsibleFilter !== 'all') activeChips.push({ id: 'responsible', label: `Responsável: ${responsibleFilter}`, onRemove: () => setResponsibleFilter('all') });
  if (anoFilter !== 'all') activeChips.push({ id: 'ano', label: `Ano: ${anoFilter}`, onRemove: () => setAnoFilter('all') });
  if (dateFrom) activeChips.push({ id: 'dateFrom', label: `De: ${dateFrom}`, onRemove: () => setDateFrom('') });
  if (dateTo) activeChips.push({ id: 'dateTo', label: `Até: ${dateTo}`, onRemove: () => setDateTo('') });
  if (valueMin) activeChips.push({ id: 'valueMin', label: `Valor mín.: R$ ${valueMin}`, onRemove: () => setValueMin('') });
  if (valueMax) activeChips.push({ id: 'valueMax', label: `Valor máx.: R$ ${valueMax}`, onRemove: () => setValueMax('') });

  useEffect(() => {
    if (!isFiltersOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFilters(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isFiltersOpen]);

  // Filter demands
  const filteredDemands = demands.filter(d => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || [
      d.id, d.title, d.municipality, d.description, d.category,
      d.organ, d.proposal_number, d.prefeitura,
      d.responsible_name, d.responsible_email, d.responsible_phone,
      d.ano ? String(d.ano) : ''
    ].some(f => (f || '').toLowerCase().includes(q));

    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || d.priority === priorityFilter;
    const matchesCategory = categoryFilter === 'all' || d.category === categoryFilter;
    const matchesUf = ufFilter === 'all' || d.uf === ufFilter;
    const matchesResponsible = responsibleFilter === 'all' || d.responsible_name === responsibleFilter;
    const matchesAno = anoFilter === 'all' || String(d.ano) === anoFilter;

    const created = new Date(d.created_at).getTime();
    const matchesDateFrom = !dateFrom || created >= new Date(dateFrom).getTime();
    const matchesDateTo = !dateTo || created <= (new Date(dateTo).getTime() + 86399999);

    const value = d.requested_value || 0;
    const matchesValueMin = !valueMin || value >= Number(valueMin);
    const matchesValueMax = !valueMax || value <= Number(valueMax);

    return matchesSearch && matchesStatus && matchesPriority && matchesCategory &&
      matchesUf && matchesResponsible && matchesAno && matchesDateFrom && matchesDateTo &&
      matchesValueMin && matchesValueMax;
  });

  // Sort demands
  const sortedDemands = [...filteredDemands].sort((a, b) => {
    if (sortBy === 'newest') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortBy === 'oldest') {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (sortBy === 'highest-value') {
      return b.requested_value - a.requested_value;
    }
    if (sortBy === 'lowest-value') {
      return a.requested_value - b.requested_value;
    }
    return 0;
  });

  // Kanban Columns
  const KANBAN_COLUMNS: { id: DemandStatus; title: string; color: string }[] = [
    { id: 'pendente', title: 'Pendentes', color: 'border-t-amber-500 bg-amber-50/20' },
    { id: 'analise', title: 'Em Análise', color: 'border-t-blue-500 bg-blue-50/20' },
    { id: 'concluido', title: 'Concluídas', color: 'border-t-green-500 bg-green-50/20' },
    { id: 'rejeitado', title: 'Rejeitadas', color: 'border-t-red-500 bg-red-50/20' }
  ];

  // Add timeline event
  const handleAddTimelineEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailedDemand || !newEventTitle.trim()) return;

    setIsSubmittingEvent(true);
    try {
      const event = await demandsApi.addTimelineEvent(detailedDemand.id, {
        title: newEventTitle,
        description: newEventDesc || 'Nenhuma descrição técnica informada.',
        status_changed_to: newEventStatus !== 'no-change' ? newEventStatus : undefined
      });

      // Update local state
      const updatedDemand = {
        ...detailedDemand,
        status: newEventStatus !== 'no-change' ? newEventStatus as DemandStatus : detailedDemand.status,
        timeline: [event, ...(detailedDemand.timeline || [])],
        updated_at: new Date().toISOString()
      };

      setDetailedDemand(updatedDemand);
      onUpdateDemand(updatedDemand);

      // Clear form
      setNewEventTitle('');
      setNewEventDesc('');
      setNewEventStatus('no-change');
      toast('success', 'Evento adicionado à linha do tempo');
    } catch (error) {
      console.error('Error adding timeline event:', error);
      toast('error', 'Erro ao adicionar evento', 'Tente novamente.');
    } finally {
      setIsSubmittingEvent(false);
    }
  };

  // Save admin notes
  const handleSaveNotes = async () => {
    if (!detailedDemand) return;
    
    try {
      const updated = await demandsApi.update(detailedDemand.id, { notes: adminNotes.trim() || undefined });
      setDetailedDemand({ ...detailedDemand, ...updated });
      setIsEditingNotes(false);
      toast('success', 'Anotações salvas');
    } catch (error) {
      console.error('Error saving notes:', error);
      toast('error', 'Erro ao salvar notas', 'Tente novamente.');
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailedDemand || !newComment.trim()) return;
    setCommentLoading(true);
    try {
      const comment = await demandsApi.addComment(detailedDemand.id, newComment.trim());
      setDetailedDemand({
        ...detailedDemand,
        comments: [...(detailedDemand.comments || []), comment],
      });
      setNewComment('');
      toast('success', 'Comentário adicionado');
    } catch (error) {
      console.error('Error adding comment:', error);
      toast('error', 'Erro ao adicionar comentário', 'Tente novamente.');
    } finally {
      setCommentLoading(false);
    }
  };

  const handlePrintDemand = () => {
    window.print();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await demandsApi.delete(deleteTarget);
      setDetailedDemand(null);
      onDeleteDemand?.(deleteTarget);
      setDeleteTarget(null);
      toast('success', 'Demanda excluída com sucesso.');
    } catch (error: any) {
      toast('error', 'Erro ao excluir demanda');
    } finally {
      setDeleting(false);
    }
  };

  const renderRowActions = (demand: Demand) => (
    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => handleOpenDetail(demand)}
        className="p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors"
        title="Visualizar"
        aria-label={`Visualizar demanda ${demand.id}`}
      >
        <Eye size={15} />
      </button>
      {canEdit && (
        <button
          onClick={() => handleQuickEdit(demand)}
          className="p-2 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
          title="Editar"
          aria-label={`Editar demanda ${demand.id}`}
        >
          <Pencil size={15} />
        </button>
      )}
      <button
        onClick={() => handleOpenHistory(demand)}
        className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
        title="Histórico"
        aria-label={`Histórico da demanda ${demand.id}`}
      >
        <History size={15} />
      </button>
      {canDelete && (
        <button
          onClick={() => setDeleteTarget(demand.id)}
          className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          title="Excluir"
          aria-label={`Excluir demanda ${demand.id}`}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );

  if (isLoading) {
    return <TableSkeleton rows={8} />;
  }

  return (
    <div className="space-y-6" id="demands-view-root">
      
      {!isAuthenticated && (
        <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-amber-900 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-amber-600 mt-0.5 shrink-0" size={18} />
            <div>
              <h4 className="text-xs font-bold">Portal de Consulta Pública (Modo Leitura)</h4>
              <p className="text-[10px] text-amber-700 leading-relaxed mt-0.5">
                Você está visualizando a fila de demandas no modo público. Para cadastrar ou editar, faça login.
              </p>
            </div>
          </div>
          <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-xl font-bold uppercase tracking-wider whitespace-nowrap self-start sm:self-center">
            Apenas Leitura
          </span>
        </div>
      )}

      {/* Page Title & View Toggles */}
      <PageHeader
        title="Fila Geral de Demandas"
        subtitle="Filtre, pesquise e acompanhe o trâmite processual das solicitações de recursos municipais."
        icon={<FolderKanban className="text-brand-700" size={26} />}
        actions={
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'list' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <ListIcon size={16} /> Lista
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'kanban' ? 'bg-white dark:bg-slate-600 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Grid size={16} /> Kanban
            </button>
          </div>
        }
      />

      {/* ACTION BAR */}
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-3 shadow-sm flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisa: ID, título, município, órgão, responsável..."
            className="w-full pl-10 pr-8 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900/60 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Limpar pesquisa"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={openFilters}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold transition-colors relative ${
              activeFilterCount > 0
                ? 'bg-brand-50 dark:bg-brand-950/30 border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-300'
                : 'bg-white dark:bg-[#111a2e] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal size={15} />
            Filtros
            {activeFilterCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[9px] font-black flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {canCreate && (
            <Suspense fallback={<div className="h-9 w-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />}>
              <ImportExportBar
                rows={filteredDemands}
                filters={{
                  search: search || undefined,
                  status: statusFilter !== 'all' ? statusFilter : undefined,
                  priority: priorityFilter !== 'all' ? priorityFilter : undefined,
                  category: categoryFilter !== 'all' ? categoryFilter : undefined,
                  uf: ufFilter !== 'all' ? ufFilter : undefined,
                  responsible: responsibleFilter !== 'all' ? responsibleFilter : undefined,
                  ano: anoFilter !== 'all' ? anoFilter : undefined,
                  dateFrom: dateFrom || undefined,
                  dateTo: dateTo || undefined,
                  valueMin: valueMin || undefined,
                  valueMax: valueMax || undefined,
                }}
                onImported={(created) => created.forEach(d => onAddDemand?.(d))}
              />
            </Suspense>
          )}

          {canCreate && (
            <button
              onClick={() => onNavigateToTab?.('new-demand')}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors shadow-sm"
            >
              <FilePlus2 size={15} />
              <span className="hidden md:inline">Nova Demanda</span>
              <span className="md:hidden">Nova</span>
            </button>
          )}
        </div>
      </div>

      {/* ACTIVE FILTER CHIPS */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map(chip => (
            <button
              key={chip.id}
              onClick={chip.onRemove}
              title={`Remover filtro ${chip.label}`}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
            >
              {chip.label}
              <span className="p-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-red-100 hover:text-red-600 transition-colors">
                <X size={11} />
              </span>
            </button>
          ))}
          <button
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            <FilterX size={12} /> Limpar todos
          </button>
          <span className="ml-auto text-[10px] font-medium text-slate-400">
            {filteredDemands.length} de {demands.length} demandas
          </span>
        </div>
      )}

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          label="Total de Demandas"
          value={filteredDemands.length}
          icon={<FolderKanban size={16} className="text-brand-600 dark:text-brand-400" />}
          iconBgCls="bg-brand-50 dark:bg-brand-950/30"
        />
        <SummaryCard
          label="Valor Global"
          value={formatCurrency(filteredDemands.reduce((s, d) => s + (d.requested_value || 0), 0))}
          valueCls="text-sm font-black text-slate-800 dark:text-white leading-tight truncate"
          icon={<DollarSign size={16} className="text-amber-600 dark:text-amber-400" />}
          iconBgCls="bg-amber-50 dark:bg-amber-950/30"
        />
        <SummaryCard
          label="Municípios"
          value={new Set(filteredDemands.map(d => d.municipality)).size}
          icon={<MapPin size={16} className="text-blue-600 dark:text-blue-400" />}
          iconBgCls="bg-blue-50 dark:bg-blue-950/30"
        />
        <SummaryCard
          label="Órgãos"
          value={new Set(filteredDemands.map(d => d.organ).filter(Boolean)).size}
          icon={<Building2 size={16} className="text-purple-600 dark:text-purple-400" />}
          iconBgCls="bg-purple-50 dark:bg-purple-950/30"
        />
      </div>

      {/* FILTERS DRAWER */}
      <FiltersDrawer
        open={isFiltersOpen && !!draft}
        onClose={closeFilters}
        onApply={applyFilters}
        onClear={() => {
          clearAllFilters();
          setDraft({ ...draft!, status: 'all', priority: 'all', category: 'all', uf: 'all', responsible: 'all', ano: 'all', dateFrom: '', dateTo: '', valueMin: '', valueMax: '' });
        }}
        title="Filtros de demandas"
      >
        {/* Busca inteligente */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            Busca Inteligente
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" size={14} />
              <input
                type="text"
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSmartSearch(); }}
                placeholder='"demandas urgentes de SP acima de 1 milhão"'
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-brand-200 dark:border-brand-800/60 bg-brand-50/40 dark:bg-brand-950/10 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <button
              onClick={runSmartSearch}
              className="px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-[10px] uppercase tracking-wider shadow-sm transition-all flex items-center gap-1.5 shrink-0"
            >
              <Sparkles size={12} /> Buscar
            </button>
          </div>
          {nlExplanation && (
            <div className="flex items-start gap-1.5 text-[10px] text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-950/20 border border-brand-100 dark:border-brand-800/40 rounded-lg px-2.5 py-1.5">
              <BrainCircuit size={12} className="mt-0.5 shrink-0" />
              <span>{nlExplanation}</span>
            </div>
          )}
        </div>

        {/* Status rápido */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">Status</label>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all', label: `Todas (${demands.length})` },
              { id: 'pendente', label: `Pendentes (${demands.filter(d => d.status === 'pendente').length})` },
              { id: 'analise', label: `Em Análise (${demands.filter(d => d.status === 'analise').length})` },
              { id: 'concluido', label: `Concluídas (${demands.filter(d => d.status === 'concluido').length})` },
              { id: 'rejeitado', label: `Rejeitadas (${demands.filter(d => d.status === 'rejeitado').length})` }
            ].map(pill => (
              <button
                key={pill.id}
                onClick={() => setDraft({ ...draft!, status: pill.id })}
                className={`px-2.5 py-1.5 rounded-full text-[10px] font-semibold border transition-colors ${
                  draft?.status === pill.id
                    ? 'bg-slate-900 text-white border-slate-950 shadow-sm dark:bg-brand-600 dark:border-brand-600'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        <Select
          label="Prioridade"
          value={draft?.priority || 'all'}
          onChange={(e) => setDraft({ ...draft!, priority: e.target.value })}
        >
          <option value="all">Todas Prioridades</option>
          <option value="baixa">Prioridade Baixa</option>
          <option value="media">Prioridade Média</option>
          <option value="alta">Prioridade Alta</option>
          <option value="urgente">Prioridade Urgente</option>
        </Select>

        <Select
          label="Categoria"
          value={draft?.category || 'all'}
          onChange={(e) => setDraft({ ...draft!, category: e.target.value })}
        >
          <option value="all">Categorias (Todas)</option>
          {CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </Select>

        <Select
          label="Estado (UF)"
          value={draft?.uf || 'all'}
          onChange={(e) => setDraft({ ...draft!, uf: e.target.value })}
        >
          <option value="all">Estados (Todos)</option>
          {uniqueUfs.map(uf => (
            <option key={uf} value={uf}>{uf}</option>
          ))}
        </Select>

        <Select
          label="Responsável"
          value={draft?.responsible || 'all'}
          onChange={(e) => setDraft({ ...draft!, responsible: e.target.value })}
        >
          <option value="all">Responsáveis (Todos)</option>
          {uniqueResponsibles.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </Select>

        <Input
          label="Ano"
          type="number"
          value={draft?.ano === 'all' ? '' : draft?.ano || ''}
          onChange={(e) => setDraft({ ...draft!, ano: e.target.value ? e.target.value : 'all' })}
          placeholder="Ano (ex: 2026)"
          min={1900}
          max={2100}
        />

        <Select
          label="Ordenar por"
          value={draft?.sortBy || 'newest'}
          onChange={(e) => setDraft({ ...draft!, sortBy: e.target.value })}
        >
          <option value="newest">Mais recentes</option>
          <option value="oldest">Mais antigos</option>
          <option value="highest-value">Maior Valor (R$)</option>
          <option value="lowest-value">Menor Valor (R$)</option>
        </Select>

        <div className="grid grid-cols-2 gap-3">
          <Input
            type="date"
            label="Data de criação (de)"
            value={draft?.dateFrom || ''}
            onChange={(e) => setDraft({ ...draft!, dateFrom: e.target.value })}
          />
          <Input
            type="date"
            label="Data de criação (até)"
            value={draft?.dateTo || ''}
            onChange={(e) => setDraft({ ...draft!, dateTo: e.target.value })}
          />
          <Input
            type="number"
            label="Valor mín. (R$)"
            value={draft?.valueMin || ''}
            onChange={(e) => setDraft({ ...draft!, valueMin: e.target.value })}
            placeholder="0"
          />
          <Input
            type="number"
            label="Valor máx. (R$)"
            value={draft?.valueMax || ''}
            onChange={(e) => setDraft({ ...draft!, valueMax: e.target.value })}
            placeholder="999999"
          />
        </div>
      </FiltersDrawer>


      {/* LIST or KANBAN VIEW */}
      {viewMode === 'list' ? (
        /* LIST VIEW */
        <div className="bg-white dark:bg-[var(--surface-card)] border border-slate-100 dark:border-slate-700/50 rounded-3xl shadow-sm overflow-hidden" id="list-view-container">
          {sortedDemands.length === 0 ? (
            <EmptyState
              icon={<AlertCircle size={40} />}
              title="Nenhuma demanda encontrada"
              subtitle="Tente ajustar seus filtros ou mude o termo pesquisado."
              className="p-12"
            />
          ) : (
            <>
              {/* MOBILE: CARD LIST */}
              <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-700/50" id="demands-card-list">
                {sortedDemands.map((demand) => (
                  <div key={demand.id} className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md truncate max-w-[55%]">
                        Nº {demand.proposal_number || 'S/N'}
                      </span>
                      <StatusBadge status={demand.status} className="py-1" />
                    </div>

                    <div className="cursor-pointer space-y-2" onClick={() => handleOpenDetail(demand)}>
                      <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 line-clamp-2" title={demand.title}>
                        {demand.title}
                      </p>
                      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <MapPin size={12} className="shrink-0" />
                        <span className="truncate">{demand.municipality}</span>
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">({demand.uf})</span>
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700/50">
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatCurrency(demand.requested_value)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {demand.updated_at ? formatDate(demand.updated_at) : '—'}
                      </span>
                    </div>

                    {renderRowActions(demand)}
                  </div>
                ))}
              </div>

              {/* TABLET & DESKTOP: TABLE */}
              <div className="hidden sm:block overflow-x-auto custom-scrollbar max-h-[calc(100vh-310px)]" id="demands-table-wrapper">
                <table className="w-full text-left border-collapse min-w-[880px]" id="demands-table">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700/50 text-[10px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 z-10">
                      <th className="py-3.5 px-4 w-[120px]">Nº Proposta</th>
                      <th className="py-3.5 px-4 w-[150px]">Município</th>
                      <th className="py-3.5 px-4 w-[50px] text-center">UF</th>
                      <th className="py-3.5 px-4 min-w-[220px]">Objeto</th>
                      <th className="py-3.5 px-4 w-[110px] text-center">Status</th>
                      <th className="py-3.5 px-4 w-[130px] text-right">Valor Global</th>
                      <th className="py-3.5 px-4 w-[120px] text-center hidden lg:table-cell">Última Atualização</th>
                      <th className="py-3.5 px-4 w-[130px] text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs text-slate-600">
                    {sortedDemands.map((demand, index) => (
                      <tr
                        key={demand.id}
                        onClick={() => handleOpenDetail(demand)}
                        className={`${
                          index % 2 === 0
                            ? 'bg-white dark:bg-transparent'
                            : 'bg-slate-50/40 dark:bg-slate-800/10'
                        } hover:bg-slate-100/70 dark:hover:bg-slate-700/20 transition-colors cursor-pointer`}
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap font-mono font-bold text-slate-600 dark:text-slate-400">
                          {demand.proposal_number || 'S/N'}
                        </td>
                        <td className="py-3.5 px-4 max-w-[150px]">
                          <span className="block truncate font-semibold text-slate-800 dark:text-slate-200" title={demand.municipality}>
                            {demand.municipality}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center whitespace-nowrap font-mono text-slate-500 dark:text-slate-400">
                          {demand.uf}
                        </td>
                        <td className="py-3.5 px-4 max-w-[420px]">
                          <p className="font-extrabold text-slate-800 dark:text-slate-200 truncate" title={demand.title}>
                            {demand.title}
                          </p>
                          {demand.category && (
                            <p className="text-[10px] text-slate-400 mt-0.5 truncate" title={demand.category}>
                              {demand.category}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <StatusBadge status={demand.status} />
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                          {formatCurrency(demand.requested_value)}
                        </td>
                        <td className="py-3.5 px-4 text-center whitespace-nowrap text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                          {demand.updated_at ? formatDate(demand.updated_at) : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {renderRowActions(demand)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : (
        /* KANBAN VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 items-start" id="kanban-view-container">
          {KANBAN_COLUMNS.map((col) => {
            const colDemands = sortedDemands.filter(d => d.status === col.id);
            const colSumValue = colDemands.reduce((acc, curr) => acc + curr.requested_value, 0);

            return (
              <div 
                key={col.id} 
                className={`border-t-4 rounded-2xl p-4 shadow-xs space-y-4 border ${col.color}`}
              >
                <div className="flex justify-between items-start pb-2 border-b border-slate-200/50">
                  <div>
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">{col.title}</h3>
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {formatCurrency(colSumValue)}
                    </p>
                  </div>
                  <span className="bg-slate-900 text-white font-mono font-bold text-[10px] px-2 py-0.5 rounded-full">
                    {colDemands.length}
                  </span>
                </div>

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {colDemands.length === 0 ? (
                    <div className="border border-dashed border-slate-200 p-6 rounded-xl text-center text-[10px] text-slate-400">
                      Vazio
                    </div>
                  ) : (
                    colDemands.map(d => (
                      <div
                        key={d.id}
                        onClick={() => handleOpenDetail(d)}
                        className="bg-white border border-slate-100 rounded-xl p-3.5 shadow-xs hover:shadow-md transition-all cursor-pointer space-y-3"
                      >
                        <div className="flex justify-between items-start text-[9px]">
                          <span className="font-mono text-slate-400 font-bold">{d.id}</span>
                          <PriorityBadge priority={d.priority} />
                        </div>

                        <div>
                          <h4 className="text-xs font-extrabold text-slate-800 line-clamp-2" title={d.title}>{d.title}</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">{d.category}</p>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-[10px]">
                          <span className="font-semibold text-slate-600">{d.municipality} ({d.uf})</span>
                          <span className="flex items-center gap-2">
                            {d.ano && <span className="text-slate-400 font-mono">{d.ano}</span>}
                            <span className="font-mono text-slate-800 font-bold">{formatCurrency(d.requested_value)}</span>
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DETAIL DRAWER/MODAL */}
      {detailedDemand && (
        <div 
          className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/40 backdrop-blur-xs animate-fade-in"
          id="demand-detail-drawer"
        >
          <div className="absolute inset-0 -z-10" onClick={() => setDetailedDemand(null)} />

          <div className="w-full max-w-4xl bg-white h-full flex flex-col justify-between shadow-2xl relative animate-slide-left overflow-y-auto">
            
            {/* Drawer Header */}
            <div className="bg-slate-900 text-white p-6 sticky top-0 z-10 flex justify-between items-start border-b border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <span className="text-xs bg-yellow-400 text-brand-900 font-mono font-black px-2.5 py-1 rounded-lg">
                    {detailedDemand.id}
                  </span>
                  <StatusBadge status={detailedDemand.status} className="px-2.5 py-1 rounded-lg text-[10px]" />
                </div>
                <h3 className="text-lg font-black tracking-tight mt-1 max-w-2xl">{detailedDemand.title}</h3>
                <p className="text-xs text-blue-200">
                  Cadastrado em {formatDate(detailedDemand.created_at)} • {detailedDemand.municipality} - {detailedDemand.uf}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!isEditingDemand && canEdit && (
                  <button
                    onClick={() => handleStartEdit(detailedDemand)}
                    className="px-3 py-1.5 bg-yellow-400 text-brand-900 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-yellow-300 transition-colors"
                  >
                    Editar
                  </button>
                )}
                <button
                  onClick={() => setDetailedDemand(null)}
                  className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                  aria-label="Fechar detalhes"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="p-6 md:p-8 space-y-8 flex-1 overflow-y-auto">

              {isEditingDemand ? (
                /* EDIT FORM */
                <div className="space-y-6">
                  <h3 className="text-sm font-extrabold text-brand-700 uppercase tracking-widest">Editar Demanda</h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Título *</label>
                      <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Município *</label>
                      <input type="text" value={editMunicipality} onChange={(e) => setEditMunicipality(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">UF</label>
                      <input type="text" value={editUf} onChange={(e) => setEditUf(e.target.value.toUpperCase())} maxLength={2}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Status</label>
                      <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as DemandStatus)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-brand-600 focus:outline-none">
                        <option value="pendente">Pendente</option>
                        <option value="analise">Em Análise</option>
                        <option value="concluido">Concluído</option>
                        <option value="rejeitado">Rejeitado</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Prioridade</label>
                      <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as DemandPriority)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-brand-600 focus:outline-none">
                        <option value="baixa">Baixa</option>
                        <option value="media">Média</option>
                        <option value="alta">Alta</option>
                        <option value="urgente">Urgente</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Ano</label>
                      <input type="text" inputMode="numeric" maxLength={4}
                        value={editAno ?? ''}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                          setEditAno(val ? Number(val) : undefined);
                        }}
                        placeholder="Ex.: 2026"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Valor Solicitado (R$)</label>
                      <input type="text" inputMode="numeric" value={editRequestedValue} onChange={(e) => setEditRequestedValue(formatCurrencyInput(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Órgão</label>
                      <input type="text" value={editOrgan} onChange={(e) => setEditOrgan(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Prefeitura</label>
                      <input type="text" value={editPrefeitura} onChange={(e) => setEditPrefeitura(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Nº Proposta</label>
                      <input type="text" value={editProposalNumber} onChange={(e) => setEditProposalNumber(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Link do Processo</label>
                      <input type="url" value={editProcessLink} onChange={(e) => setEditProcessLink(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Responsável</label>
                      <input type="text" value={editResponsibleName} onChange={(e) => setEditResponsibleName(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">E-mail Responsável</label>
                      <input type="email" value={editResponsibleEmail} onChange={(e) => setEditResponsibleEmail(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-bold text-slate-700 block">Descrição</label>
                      <textarea rows={3} value={editDescription} onChange={(e) => setEditDescription(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-bold text-slate-700 block">Observações</label>
                      <textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none" />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4 border-t border-slate-100">
                    <button onClick={() => setIsEditingDemand(false)}
                      className="py-2.5 px-6 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider">
                      Cancelar
                    </button>
                    <button onClick={handleSaveEdit} disabled={isSavingEdit}
                      className="py-2.5 px-6 rounded-xl bg-brand-700 hover:bg-brand-800 text-white font-bold text-xs uppercase tracking-wider disabled:opacity-50">
                      {isSavingEdit ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                  </div>
                </div>
              ) : (
              <>
              {/* DETAIL VIEW */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Valor Estimado</span>
                  <span className="text-md font-black text-slate-900 font-mono block mt-1">
                    {formatCurrency(detailedDemand.requested_value)}
                  </span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Nº da Proposta</span>
                  <span className="text-xs font-extrabold text-slate-800 block mt-1 font-mono truncate">
                    {detailedDemand.proposal_number || 'S/N Proposta'}
                  </span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Órgão Destino</span>
                  <span className="text-xs font-extrabold text-blue-800 block mt-1 font-mono uppercase">
                    {detailedDemand.organ || 'Não informado'}
                  </span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Criticidade</span>
                  <PriorityBadge priority={detailedDemand.priority} className="mt-1.5" />
                </div>
              </div>

              {/* Process Metadata */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-2xl border border-slate-100/80 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold mb-1">Prefeitura Solicitante</span>
                  <p className="font-extrabold text-slate-800 leading-snug">
                    {detailedDemand.prefeitura || `Prefeitura Municipal de ${detailedDemand.municipality}`}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold mb-1">Link do Processo</span>
                  {detailedDemand.process_link ? (
                    <a 
                      href={detailedDemand.process_link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="font-extrabold text-blue-600 hover:underline inline-flex items-center gap-1"
                    >
                      Acessar Processo <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="text-slate-400 font-semibold italic">Não informado</span>
                  )}
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Descrição Técnica</h4>
                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  {detailedDemand.description}
                </p>
              </div>

              {/* Responsible Info */}
              <div className="border border-slate-200/60 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50/20">
                <div className="flex items-center gap-2.5 text-xs">
                  <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center">
                    <User size={16} />
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block">Responsável</span>
                    <strong className="text-slate-700">{detailedDemand.responsible_name}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 text-xs">
                  <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center">
                    <Mail size={16} />
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block">E-mail</span>
                    <strong className="text-slate-700 font-mono truncate max-w-[180px] block">{detailedDemand.responsible_email}</strong>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 text-xs">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
                    <Phone size={16} />
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block">Telefone</span>
                    <strong className="text-slate-700 font-mono">{detailedDemand.responsible_phone}</strong>
                  </div>
                </div>
              </div>

              {/* AI Panel */}
              <div className="rounded-2xl border border-brand-200/60 dark:border-brand-800/40 bg-gradient-to-br from-brand-50/60 to-brand-50/40 dark:from-brand-950/20 dark:to-brand-950/10 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-brand-700 dark:text-brand-200 uppercase tracking-wider">Assistente IA</h4>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Análise automática da demanda</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase mb-2">
                      <BrainCircuit size={13} /> Resumo Automático
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {summarizeDemand(detailedDemand)}
                    </p>
                  </div>

                  <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase mb-2">
                      <BrainCircuit size={13} /> Sugestão de Prioridade
                    </div>
                    <AISuggestion demand={detailedDemand} />
                  </div>
                </div>

                <AISimilar demand={detailedDemand} all={demands} onSelect={(d) => handleOpenDetail(d)} />
              </div>

              {/* Detail Tabs */}
              <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
                {[
                  { id: 'timeline', label: 'Trâmites' },
                  { id: 'comments', label: 'Comentários' },
                  { id: 'history', label: 'Histórico' },
                ].map(tab => (
                  <button key={tab.id} onClick={() => setDetailTab(tab.id)}
                    className={`text-xs font-bold px-4 py-2.5 border-b-2 transition-colors ${
                      detailTab === tab.id
                        ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                        : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {detailTab === 'history' ? (
                <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 p-4">
                  <DemandHistory demandId={detailedDemand.id} />
                </div>
              ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                <div className="lg:col-span-8 space-y-6">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Histórico de Trâmites</h4>
                    <p className="text-[10px] text-slate-400">Linha do tempo oficial auditável</p>
                  </div>

                  {canEdit ? (
                    <form onSubmit={handleAddTimelineEvent} className="bg-slate-50 border border-slate-100 p-4 rounded-2xl space-y-3">
                      <span className="text-[10px] font-bold text-brand-700 uppercase tracking-wider flex items-center gap-1">
                        <CornerDownRight size={12} />
                        Registrar Despacho / Parecer Técnico
                      </span>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={newEventTitle}
                          onChange={(e) => setNewEventTitle(e.target.value)}
                          placeholder="Ex: Parecer de Engenharia Emitido"
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-600"
                          required
                        />
                        <select
                          value={newEventStatus}
                          onChange={(e) => setNewEventStatus(e.target.value)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none"
                        >
                          <option value="no-change">Manter Status Atual</option>
                          <option value="pendente">Mudar para Pendente</option>
                          <option value="analise">Mudar para Em Análise</option>
                          <option value="concluido">Mudar para Concluído</option>
                          <option value="rejeitado">Mudar para Rejeitado</option>
                        </select>
                      </div>

                      <textarea
                        rows={2}
                        value={newEventDesc}
                        onChange={(e) => setNewEventDesc(e.target.value)}
                        placeholder="Descreva as deliberações ou pendências..."
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-600"
                      />

                      <button
                        type="submit"
                        disabled={isSubmittingEvent || !newEventTitle.trim()}
                        className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-950 text-white font-bold text-[10px] uppercase rounded-lg shadow-xs flex items-center gap-1.5 ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSubmittingEvent ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Plus size={12} />
                        )}
                        Salvar Parecer
                      </button>
                    </form>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200/60 p-5 rounded-2xl text-center space-y-2">
                      <ShieldCheck className="mx-auto text-slate-400" size={20} />
                      <h5 className="text-xs font-bold text-slate-700">Trâmite Restrito</h5>
                      <p className="text-[10px] text-slate-500 max-w-md mx-auto leading-relaxed">
                        Faça login com permissão de administrador para registrar pareceres técnicos.
                      </p>
                    </div>
                  )}

                  {/* Timeline */}
                  <div className="relative border-l-2 border-slate-100 ml-2 pl-4 space-y-4">
                    {(detailedDemand.timeline || []).map((item) => (
                      <div key={item.id} className="relative group text-xs text-slate-600">
                        <span className="absolute -left-[23px] top-1 w-3 h-3 rounded-full border-2 border-white bg-slate-900 shadow-xs" />
                        <div className="space-y-0.5">
                          <div className="flex justify-between items-center text-[10px]">
                            <strong className="text-slate-800 font-bold">{item.title}</strong>
                            <span className="text-[9px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.2 rounded">
                              {formatDate(item.created_at)}
                            </span>
                          </div>
                          <p className="text-slate-500 text-[11px] leading-relaxed">{item.description}</p>
                          <div className="text-[9px] text-slate-400 flex items-center gap-1">
                            <span>Agente: <strong>{item.user_name}</strong></span>
                            {item.status_changed_to && (
                              <>
                                <span>•</span>
                                <span className="text-blue-700 bg-blue-50 font-semibold uppercase px-1.5 rounded">
                                  Novo Status: {statusLabel(item.status_changed_to)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Side: Attachments & Notes */}
                <div className="lg:col-span-4 space-y-6">
                  <div className="space-y-2">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1">
                      <Paperclip size={14} /> Documentos Anexos
                    </h4>
                    
                    {(detailedDemand.attachments || []).length === 0 && !canEdit ? (
                      <p className="text-[10px] text-slate-400 italic bg-slate-50 p-3 rounded-xl border border-dashed border-slate-200">
                        Nenhum anexo enviado.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {(detailedDemand.attachments || []).map((file) => (
                          <div key={file.id || file.name}
                            className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-xl hover:bg-slate-100 transition-colors text-[11px] font-mono text-slate-600"
                          >
                            <a href={file.id ? demandsApi.getAttachmentUrl(file.id) : '#'}
                              target={file.id ? '_blank' : undefined}
                              rel="noopener noreferrer"
                              className="truncate max-w-[160px] font-semibold text-slate-800 flex items-center gap-1.5 hover:text-blue-700"
                            >
                              <FileText size={12} className="text-blue-600 shrink-0" />
                              <span className="truncate">{file.name}</span>
                            </a>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[9px] text-slate-400">{file.size}</span>
                              {canEdit && file.id && (
                                <button onClick={() => handleDeleteAttachment(file.id!)}
                                  className="text-red-400 hover:text-red-600 p-0.5">
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        {canEdit && (
                          <div className="pt-1">
                            <input type="file" multiple ref={fileInputRef}
                              onChange={handleUploadFiles} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.svg,.txt,.csv,.zip,.rar" />
                            <button onClick={() => fileInputRef.current?.click()}
                              disabled={uploadingAttachments}
                              className="w-full text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-dashed border-blue-200 rounded-xl py-2 transition-colors flex items-center justify-center gap-1"
                            >
                              {uploadingAttachments ? (
                                <><Loader2 size={12} className="animate-spin" /> Enviando...</>
                              ) : (
                                <><Plus size={12} /> Adicionar arquivos</>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Admin Notes */}
                  <div className="bg-amber-50/40 border border-amber-100 rounded-2xl p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-[10px] font-extrabold text-amber-900 uppercase tracking-widest flex items-center gap-1">
                        <Edit2 size={12} />
                        Notas Administrativas
                      </h4>
                      {!isEditingNotes && isAuthenticated && user?.role === 'admin' && (
                        <button
                          onClick={() => setIsEditingNotes(true)}
                          className="text-[9px] font-bold text-amber-700 hover:underline"
                        >
                          Editar
                        </button>
                      )}
                    </div>

                    {isEditingNotes ? (
                      <div className="space-y-2">
                        <textarea
                          rows={4}
                          value={adminNotes}
                          onChange={(e) => setAdminNotes(e.target.value)}
                          placeholder="Anotações privadas..."
                          className="w-full p-2 bg-white border border-amber-200 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500 rounded-lg font-sans"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setAdminNotes(detailedDemand.notes || '');
                              setIsEditingNotes(false);
                            }}
                            className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-[9px] uppercase rounded"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveNotes}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-950 text-white font-bold text-[9px] uppercase rounded shadow-xs"
                          >
                            Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-600 leading-relaxed italic">
                        {detailedDemand.notes || 'Nenhuma anotação registrada.'}
                      </p>
                    )}
                  </div>

                  {/* Internal Comments */}
                  <div className="bg-blue-50/40 border border-blue-100 rounded-2xl p-4 space-y-3">
                    <h4 className="text-[10px] font-extrabold text-blue-900 uppercase tracking-widest flex items-center gap-1">
                      <MessageSquare size={12} />
                      Comentários Internos
                    </h4>

                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {(detailedDemand.comments || []).length === 0 ? (
                        <p className="text-[10px] text-slate-400 italic">
                          Nenhum comentário. Use para alinhar com a equipe.
                        </p>
                      ) : (
                        (detailedDemand.comments || []).map((c) => (
                          <div key={c.id} className="bg-white border border-blue-100 rounded-xl p-2.5 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-700">{c.user_name}</span>
                              <span className="text-[9px] text-slate-400">{formatDate(c.created_at)}</span>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">{c.body}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {hasPermission('demands.edit') && (
                      <form onSubmit={handleAddComment} className="space-y-2">
                        <textarea
                          rows={2}
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Escreva um comentário..."
                          className="w-full p-2 bg-white border border-blue-200 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500 rounded-lg font-sans"
                        />
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={commentLoading || !newComment.trim()}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] uppercase rounded disabled:opacity-50 flex items-center gap-1"
                          >
                            {commentLoading ? 'Enviando...' : (<><Send size={11} /> Comentar</>)}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </div>
              )}
              </>
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 sticky bottom-0 z-10 flex flex-col sm:flex-row gap-2 justify-between">
              <button
                onClick={handlePrintDemand}
                className="py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <Printer size={14} /> Imprimir
              </button>
              {canDelete && (
                <button
                  onClick={() => setDeleteTarget(detailedDemand.id)}
                  className="py-2.5 px-4 rounded-xl border border-red-200 hover:bg-red-50 text-red-600 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} /> Excluir
                </button>
              )}
              <button
                onClick={() => setDetailedDemand(null)}
                className="py-2.5 px-6 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Excluir Demanda"
        message="Tem certeza que deseja excluir esta demanda? Esta ação não poderá ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}

const SUGGEST_BADGE: Record<string, string> = {
  urgente: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  alta: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  media: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  baixa: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function AISuggestion({ demand }: { demand: Demand }) {
  const { priority, reason } = useMemo(() => suggestPriority(demand), [demand]);
  const isDifferent = priority !== demand.priority;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${SUGGEST_BADGE[priority]}`}>
          {priority}
        </span>
        {isDifferent && (
          <span className="text-[9px] text-slate-400 font-semibold">atual: {demand.priority}</span>
        )}
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{reason}</p>
    </div>
  );
}

function AISimilar({ demand, all, onSelect }: { demand: Demand; all: Demand[]; onSelect: (d: Demand) => void }) {
  const similar = useMemo(() => findSimilar(demand, all, 4), [demand, all]);
  if (similar.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase mb-2">
          <Sparkles size={13} /> Demandas Similares
        </div>
        <p className="text-[11px] text-slate-400">Nenhuma demanda similar encontrada.</p>
      </div>
    );
  }
  return (
    <div className="bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50 md:col-span-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-brand-700 dark:text-brand-300 uppercase mb-2">
        <Sparkles size={13} /> Demandas Similares
      </div>
      <div className="flex flex-wrap gap-2">
        {similar.map(d => (
          <button
            key={d.id}
            onClick={() => onSelect(d)}
            className="text-left px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-600 transition-colors flex-1 min-w-[200px]"
          >
            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">{d.title}</p>
            <p className="text-[9px] text-slate-400 font-mono mt-0.5">{d.id} • {d.municipality}/{d.uf}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

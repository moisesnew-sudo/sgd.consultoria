import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Grid, 
  List as ListIcon, 
  X, 
  ExternalLink, 
  AlertCircle, 
  Calendar, 
  User, 
  Phone, 
  Mail, 
  FileText, 
  Paperclip, 
  Plus, 
  CornerDownRight, 
  CheckCircle,
  Printer,
  Edit2,
  FolderKanban,
  ShieldCheck,
  Loader2,
  Trash2
} from 'lucide-react';
import { Demand, DemandStatus, DemandPriority, TimelineEvent, PaginatedResponse } from '../types';
import { demandsApi, formatCurrency, formatDate } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface DemandsViewProps {
  demands: Demand[];
  selectedDemandFromDashboard: Demand | null;
  clearSelectedDemandFromDashboard: () => void;
  onUpdateDemand: (updated: Demand) => void;
  isLoading: boolean;
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
  isLoading
}: DemandsViewProps) {
  const { user, isAuthenticated } = useAuth();
  
  // Search & Filters State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [ufFilter, setUfFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');

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
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  // Edit demand state
  const [isEditingDemand, setIsEditingDemand] = useState(false);
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
    setEditRequestedValue(String(demand.requested_value || ''));
    setEditOrgan(demand.organ || '');
    setEditPrefeitura(demand.prefeitura || '');
    setEditProposalNumber(demand.proposal_number || '');
    setEditProcessLink(demand.process_link || '');
    setEditResponsibleName(demand.responsible_name || '');
    setEditResponsibleEmail(demand.responsible_email || '');
    setEditResponsiblePhone(demand.responsible_phone || '');
    setEditNotes(demand.notes || '');
    setIsEditingDemand(true);
  };

  const handleSaveEdit = async () => {
    if (!detailedDemand || !editTitle.trim() || !editMunicipality.trim()) return;
    setIsSavingEdit(true);
    try {
      const updated = await demandsApi.update(detailedDemand.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        status: editStatus,
        priority: editPriority,
        municipality: editMunicipality.trim(),
        uf: editUf,
        requested_value: editRequestedValue ? Number(editRequestedValue) : 0,
        organ: editOrgan.trim() || undefined,
        prefeitura: editPrefeitura.trim() || undefined,
        proposal_number: editProposalNumber.trim() || undefined,
        process_link: editProcessLink.trim() || undefined,
        responsible_name: editResponsibleName.trim() || undefined,
        responsible_email: editResponsibleEmail.trim() || undefined,
        responsible_phone: editResponsiblePhone.trim() || undefined,
        notes: editNotes.trim() || undefined
      });
      onUpdateDemand(updated);
      setDetailedDemand(updated);
      setIsEditingDemand(false);
    } catch (err: any) {
      alert('Erro ao salvar: ' + (err.message || 'Tente novamente'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  // List of unique UFs
  const uniqueUfs = Array.from(new Set(demands.map(d => d.uf))).sort();

  // Filter demands
  const filteredDemands = demands.filter(d => {
    const matchesSearch = 
      d.id.toLowerCase().includes(search.toLowerCase()) ||
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.municipality.toLowerCase().includes(search.toLowerCase()) ||
      d.description.toLowerCase().includes(search.toLowerCase()) ||
      (d.responsible_name && d.responsible_name.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || d.priority === priorityFilter;
    const matchesCategory = categoryFilter === 'all' || d.category === categoryFilter;
    const matchesUf = ufFilter === 'all' || d.uf === ufFilter;

    return matchesSearch && matchesStatus && matchesPriority && matchesCategory && matchesUf;
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
    { id: 'analise', title: 'Em Análise', color: 'border-t-indigo-500 bg-indigo-50/20' },
    { id: 'concluido', title: 'Concluídas', color: 'border-t-green-500 bg-green-50/20' },
    { id: 'rejeitado', title: 'Rejeitadas', color: 'border-t-red-500 bg-red-50/20' }
  ];

  const getStatusBadgeClass = (status: DemandStatus) => {
    switch (status) {
      case 'pendente': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'analise': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'concluido': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejeitado': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getPriorityBadgeClass = (priority: DemandPriority) => {
    switch (priority) {
      case 'baixa': return 'bg-slate-50 text-slate-600 border-slate-200';
      case 'media': return 'bg-blue-50 text-blue-600 border-blue-200';
      case 'alta': return 'bg-amber-50 text-amber-600 border-amber-200';
      case 'urgente': return 'bg-red-50 text-red-600 border-red-200';
      default: return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  const getStatusLabel = (status: DemandStatus) => {
    switch (status) {
      case 'pendente': return 'Pendente';
      case 'analise': return 'Em Análise';
      case 'concluido': return 'Concluído';
      case 'rejeitado': return 'Rejeitado';
    }
  };

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
    } catch (error) {
      console.error('Error adding timeline event:', error);
      alert('Erro ao adicionar evento. Tente novamente.');
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
    } catch (error) {
      console.error('Error saving notes:', error);
      alert('Erro ao salvar notas. Tente novamente.');
    }
  };

  const handlePrintDemand = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 text-slate-900 animate-spin" />
          <p className="text-xs font-semibold text-slate-500">Carregando demandas...</p>
        </div>
      </div>
    );
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <FolderKanban className="text-indigo-950" size={26} />
            Fila Geral de Demandas
          </h2>
          <p className="text-sm text-slate-500">
            Filtre, pesquise e acompanhe o trâmite processual das solicitações de recursos municipais.
          </p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl self-start md:self-center">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'list' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ListIcon size={16} /> Lista
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'kanban' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Grid size={16} /> Kanban
          </button>
        </div>
      </div>

      {/* FILTER & SEARCH BAR */}
      <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-4" id="filters-section">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          
          <div className="md:col-span-4 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar ID, título, município..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
            />
          </div>

          <div className="md:col-span-2">
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:outline-none"
            >
              <option value="all">Todas Prioridades</option>
              <option value="baixa">Prioridade Baixa</option>
              <option value="media">Prioridade Média</option>
              <option value="alta">Prioridade Alta</option>
              <option value="urgente">Prioridade Urgente</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:outline-none"
            >
              <option value="all">Categorias (Todas)</option>
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={ufFilter}
              onChange={(e) => setUfFilter(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:outline-none"
            >
              <option value="all">Estados (Todos)</option>
              {uniqueUfs.map(uf => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:outline-none"
            >
              <option value="newest">Mais recentes</option>
              <option value="oldest">Mais antigos</option>
              <option value="highest-value">Maior Valor (R$)</option>
              <option value="lowest-value">Menor Valor (R$)</option>
            </select>
          </div>
        </div>

        {/* Quick Status Filters */}
        {viewMode === 'list' && (
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase self-center mr-2">Filtro Rápido:</span>
            {[
              { id: 'all', label: `Todas (${demands.length})` },
              { id: 'pendente', label: `Pendentes (${demands.filter(d => d.status === 'pendente').length})` },
              { id: 'analise', label: `Em Análise (${demands.filter(d => d.status === 'analise').length})` },
              { id: 'concluido', label: `Concluídas (${demands.filter(d => d.status === 'concluido').length})` },
              { id: 'rejeitado', label: `Rejeitadas (${demands.filter(d => d.status === 'rejeitado').length})` }
            ].map(pill => (
              <button
                key={pill.id}
                onClick={() => setStatusFilter(pill.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  statusFilter === pill.id
                    ? 'bg-slate-900 text-white border-slate-950 shadow-sm font-semibold'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* LIST or KANBAN VIEW */}
      {viewMode === 'list' ? (
        /* LIST VIEW */
        <div className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden" id="list-view-container">
          {sortedDemands.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <AlertCircle size={40} className="text-slate-300 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700">Nenhuma demanda encontrada</h3>
              <p className="text-xs text-slate-400">Tente ajustar seus filtros ou mude o termo pesquisado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse" id="demands-table">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-4 px-6">ID</th>
                    <th className="py-4 px-6">Título da Demanda</th>
                    <th className="py-4 px-6">Município / UF</th>
                    <th className="py-4 px-6">Valor Solicitado</th>
                    <th className="py-4 px-6">Criticidade</th>
                    <th className="py-4 px-6">Status</th>
                    <th className="py-4 px-6 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-600">
                  {sortedDemands.map((demand) => (
                    <tr 
                      key={demand.id} 
                      className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                      onClick={() => handleOpenDetail(demand)}
                    >
                      <td className="py-4 px-6 font-mono font-bold text-slate-500 whitespace-nowrap">
                        {demand.id}
                      </td>
                      <td className="py-4 px-6 max-w-xs md:max-w-md">
                        <p className="font-extrabold text-slate-800 truncate" title={demand.title}>{demand.title}</p>
                        <p className="text-[10px] text-slate-400 truncate">{demand.category}</p>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <div className="font-semibold text-slate-800">{demand.municipality}</div>
                        <div className="text-[10px] text-slate-400">Estado: {demand.uf}</div>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap font-mono font-semibold text-slate-800">
                        {formatCurrency(demand.requested_value)}
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${getPriorityBadgeClass(demand.priority)}`}>
                          {demand.priority}
                        </span>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${getStatusBadgeClass(demand.status)}`}>
                          {getStatusLabel(demand.status)}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleOpenDetail(demand)}
                          className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-[10px] font-bold transition-all flex items-center gap-1.5 ml-auto border border-blue-100"
                        >
                          Detalhes <ExternalLink size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                          <span className={`px-1.5 py-0.5 rounded-xs font-bold uppercase ${getPriorityBadgeClass(d.priority)}`}>
                            {d.priority}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-xs font-extrabold text-slate-800 line-clamp-2" title={d.title}>{d.title}</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">{d.category}</p>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-slate-100 text-[10px]">
                          <span className="font-semibold text-slate-600">{d.municipality} ({d.uf})</span>
                          <span className="font-mono text-slate-800 font-bold">{formatCurrency(d.requested_value)}</span>
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
                  <span className="text-xs bg-yellow-400 text-blue-950 font-mono font-black px-2.5 py-1 rounded-lg">
                    {detailedDemand.id}
                  </span>
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${getStatusBadgeClass(detailedDemand.status)}`}>
                    {getStatusLabel(detailedDemand.status)}
                  </span>
                </div>
                <h3 className="text-lg font-black tracking-tight mt-1 max-w-2xl">{detailedDemand.title}</h3>
                <p className="text-xs text-blue-200">
                  Cadastrado em {formatDate(detailedDemand.created_at)} • {detailedDemand.municipality} - {detailedDemand.uf}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!isEditingDemand && (
                  <button
                    onClick={() => handleStartEdit(detailedDemand)}
                    className="px-3 py-1.5 bg-yellow-400 text-blue-950 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-yellow-300 transition-colors"
                  >
                    Editar
                  </button>
                )}
                <button
                  onClick={() => setDetailedDemand(null)}
                  className="p-2 text-blue-200 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
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
                  <h3 className="text-sm font-extrabold text-indigo-950 uppercase tracking-widest">Editar Demanda</h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Título *</label>
                      <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Município *</label>
                      <input type="text" value={editMunicipality} onChange={(e) => setEditMunicipality(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">UF</label>
                      <input type="text" value={editUf} onChange={(e) => setEditUf(e.target.value)} maxLength={2}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Status</label>
                      <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as DemandStatus)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-600 focus:outline-none">
                        <option value="pendente">Pendente</option>
                        <option value="analise">Em Análise</option>
                        <option value="concluido">Concluído</option>
                        <option value="rejeitado">Rejeitado</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Prioridade</label>
                      <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as DemandPriority)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-blue-600 focus:outline-none">
                        <option value="baixa">Baixa</option>
                        <option value="media">Média</option>
                        <option value="alta">Alta</option>
                        <option value="urgente">Urgente</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Valor Solicitado (R$)</label>
                      <input type="number" value={editRequestedValue} onChange={(e) => setEditRequestedValue(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Órgão</label>
                      <input type="text" value={editOrgan} onChange={(e) => setEditOrgan(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Prefeitura</label>
                      <input type="text" value={editPrefeitura} onChange={(e) => setEditPrefeitura(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Nº Proposta</label>
                      <input type="text" value={editProposalNumber} onChange={(e) => setEditProposalNumber(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Link do Processo</label>
                      <input type="url" value={editProcessLink} onChange={(e) => setEditProcessLink(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">Responsável</label>
                      <input type="text" value={editResponsibleName} onChange={(e) => setEditResponsibleName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 block">E-mail Responsável</label>
                      <input type="email" value={editResponsibleEmail} onChange={(e) => setEditResponsibleEmail(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-bold text-slate-700 block">Descrição</label>
                      <textarea rows={3} value={editDescription} onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-bold text-slate-700 block">Observações</label>
                      <textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none" />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4 border-t border-slate-100">
                    <button onClick={() => setIsEditingDemand(false)}
                      className="py-2.5 px-6 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider">
                      Cancelar
                    </button>
                    <button onClick={handleSaveEdit} disabled={isSavingEdit}
                      className="py-2.5 px-6 rounded-xl bg-slate-900 hover:bg-indigo-950 text-white font-bold text-xs uppercase tracking-wider disabled:opacity-50">
                      {isSavingEdit ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                  </div>
                </div>
              ) : (
              /* DETAIL VIEW */
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
                  <span className={`inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${getPriorityBadgeClass(detailedDemand.priority)}`}>
                    {detailedDemand.priority}
                  </span>
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
                  <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center">
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

              {/* Timeline & Notes */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                <div className="lg:col-span-8 space-y-6">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Histórico de Trâmites</h4>
                    <p className="text-[10px] text-slate-400">Linha do tempo oficial auditável</p>
                  </div>

                  {isAuthenticated && user?.role !== 'viewer' ? (
                    <form onSubmit={handleAddTimelineEvent} className="bg-slate-50 border border-slate-100 p-4 rounded-2xl space-y-3">
                      <span className="text-[10px] font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-1">
                        <CornerDownRight size={12} />
                        Registrar Despacho / Parecer Técnico
                      </span>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={newEventTitle}
                          onChange={(e) => setNewEventTitle(e.target.value)}
                          placeholder="Ex: Parecer de Engenharia Emitido"
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
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
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-600"
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
                                  Novo Status: {getStatusLabel(item.status_changed_to)}
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
                    
                    {(detailedDemand.attachments || []).length === 0 ? (
                      <p className="text-[10px] text-slate-400 italic bg-slate-50 p-3 rounded-xl border border-dashed border-slate-200">
                        Nenhum anexo enviado.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {(detailedDemand.attachments || []).map((file, idx) => (
                          <div 
                            key={idx} 
                            className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-xl hover:bg-slate-100 transition-colors text-[11px] font-mono text-slate-600"
                          >
                            <span className="truncate max-w-[180px] font-semibold text-slate-800 flex items-center gap-1.5">
                              <FileText size={12} className="text-blue-600" />
                              {file.name}
                            </span>
                            <span className="text-[9px] text-slate-400 whitespace-nowrap">{file.size}</span>
                          </div>
                        ))}
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
                </div>
              </div>
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 sticky bottom-0 z-10 flex flex-col sm:flex-row gap-2 justify-between">
              <button
                onClick={handlePrintDemand}
                className="py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
              >
                <Printer size={14} /> Imprimir
              </button>
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
    </div>
  );
}
import React, { useState } from 'react';
import { MapPin, Plus, Search, Edit2, Trash2, X, Save, Loader2 } from 'lucide-react';
import { municipalitiesApi } from '../../services/api';
import { MunicipalityData } from '../../types';
import { BRAZILIAN_STATES } from '../../lib/demandMeta';
import { useToast } from '../../contexts/ToastContext';
import { ConfirmModal } from '../ui/ConfirmModal';
import { PageHeader } from '../ui/PageHeader';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Fields';

interface MunicipalitiesViewProps {
  municipalities: MunicipalityData[];
  setMunicipalities: React.Dispatch<React.SetStateAction<MunicipalityData[]>>;
}

const REGIONS: { [key: string]: string[] } = {
  'Norte': ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'],
  'Nordeste': ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MS', 'MT'],
  'Sudeste': ['ES', 'MG', 'RJ', 'SP'],
  'Sul': ['PR', 'RS', 'SC']
};

const getRegionForUf = (uf: string): string => {
  for (const [region, states] of Object.entries(REGIONS)) {
    if (states.includes(uf)) return region;
  }
  return 'Desconhecida';
};

export default function MunicipalitiesView({ municipalities, setMunicipalities }: MunicipalitiesViewProps) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUf, setSelectedUf] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingMunicipality, setEditingMunicipality] = useState<MunicipalityData | null>(null);
  const [formName, setFormName] = useState('');
  const [formUf, setFormUf] = useState('CE');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MunicipalityData | null>(null);

  const filteredMunicipalities = municipalities.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesUf = !selectedUf || m.uf === selectedUf;
    return matchesSearch && matchesUf;
  });

  const handleAdd = () => {
    setEditingMunicipality(null);
    setFormName('');
    setFormUf('CE');
    setShowModal(true);
  };

  const handleEdit = (m: MunicipalityData) => {
    setEditingMunicipality(m);
    setFormName(m.name);
    setFormUf(m.uf);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    setIsSaving(true);
    try {
      if (editingMunicipality) {
        if (editingMunicipality.id) {
          await municipalitiesApi.update(editingMunicipality.id, { name: formName.trim(), uf: formUf });
        }
        setMunicipalities(prev => prev.map(m =>
          m.name === editingMunicipality.name && m.uf === editingMunicipality.uf
            ? { ...m, name: formName.trim(), uf: formUf }
            : m
        ));
      } else {
        const exists = municipalities.some(
          m => m.name.toLowerCase() === formName.trim().toLowerCase() && m.uf === formUf
        );
        if (exists) {
          toast('warning', 'Município já cadastrado para esta UF.');
          return;
        }
        const created = await municipalitiesApi.create({ name: formName.trim(), uf: formUf });
        setMunicipalities(prev => [...prev, created]);
      }
      setShowModal(false);
      toast('success', editingMunicipality ? 'Município atualizado' : 'Município cadastrado');
    } catch (err: any) {
      toast('error', 'Erro ao salvar', err?.message || 'Tente novamente');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (m: MunicipalityData) => {
    setDeleteTarget(m);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.id) await municipalitiesApi.delete(deleteTarget.id);
      setMunicipalities(prev => prev.filter(x => !(x.name === deleteTarget.name && x.uf === deleteTarget.uf)));
      toast('success', 'Município removido com sucesso');
    } catch (err: any) {
      toast('error', 'Erro ao remover', err?.message || 'Tente novamente');
    } finally {
      setDeleteTarget(null);
    }
  };

  const ufCounts = municipalities.reduce((acc, m) => {
    acc[m.uf] = (acc[m.uf] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Municípios Cadastrados"
        subtitle={`${municipalities.length} municípios registrados em ${Object.keys(ufCounts).length} estados.`}
        icon={<MapPin className="text-brand-700" size={26} />}
        actions={
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-700 text-white text-xs font-bold uppercase tracking-wider hover:bg-brand-800 transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} />
            Novo Município
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Buscar município..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
          />
        </div>
        <select
          value={selectedUf}
          onChange={(e) => setSelectedUf(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-transparent"
        >
          <option value="">Todas as UFs</option>
          {BRAZILIAN_STATES.filter(uf => ufCounts[uf]).map(uf => (
            <option key={uf} value={uf}>{uf} ({ufCounts[uf]})</option>
          ))}
        </select>
      </div>

      {/* Municipalities Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredMunicipalities.map((m) => (
              <div key={`${m.name}-${m.uf}`} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow group">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">{m.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {m.uf} · {getRegionForUf(m.uf)}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                    onClick={() => handleEdit(m)}
                    title={`Editar ${m.name}`}
                    aria-label={`Editar ${m.name}`}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(m)}
                  title={`Remover ${m.name}`}
                  aria-label={`Remover ${m.name}`}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredMunicipalities.length === 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl">
          <EmptyState
            icon={<MapPin size={32} />}
            title="Nenhum município encontrado"
            className="py-12"
          />
        </div>
      )}

      {/* Modal */}
      <Modal
        open={showModal}
        title={editingMunicipality ? 'Editar Município' : 'Novo Município'}
        onClose={() => setShowModal(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving || !formName.trim()} loading={isSaving} icon={<Save size={14} />}>
              {editingMunicipality ? 'Atualizar' : 'Cadastrar'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Nome do Município *" required value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Petrolina" />
          <Select label="UF *" value={formUf} onChange={(e) => setFormUf(e.target.value)}>
            {BRAZILIAN_STATES.map(uf => (
              <option key={uf} value={uf}>{uf}</option>
            ))}
          </Select>
        </div>
      </Modal>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Remover Município"
        message={`Tem certeza que deseja remover ${deleteTarget?.name} - ${deleteTarget?.uf}? Esta ação não poderá ser desfeita.`}
        confirmLabel="Remover"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
import React, { useState, useEffect } from 'react';
import { MapPin, Plus, Search, Edit2, Trash2, X, Save, Loader2 } from 'lucide-react';
import { municipalitiesApi } from '../services/api';
import { MunicipalityData } from '../types';

interface MunicipalitiesViewProps {
  municipalities: MunicipalityData[];
  setMunicipalities: React.Dispatch<React.SetStateAction<MunicipalityData[]>>;
}

const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

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
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUf, setSelectedUf] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingMunicipality, setEditingMunicipality] = useState<MunicipalityData | null>(null);
  const [formName, setFormName] = useState('');
  const [formUf, setFormUf] = useState('CE');
  const [isSaving, setIsSaving] = useState(false);

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
        await municipalitiesApi.update(editingMunicipality.id, { name: formName.trim(), uf: formUf });
        setMunicipalities(prev => prev.map(m =>
          m.name === editingMunicipality.name && m.uf === editingMunicipality.uf
            ? { name: formName.trim(), uf: formUf }
            : m
        ));
      } else {
        const exists = municipalities.some(
          m => m.name.toLowerCase() === formName.trim().toLowerCase() && m.uf === formUf
        );
        if (exists) {
          alert('Município já cadastrado para esta UF.');
          return;
        }
        await municipalitiesApi.create({ name: formName.trim(), uf: formUf });
        setMunicipalities(prev => [...prev, { name: formName.trim(), uf: formUf }]);
      }
      setShowModal(false);
    } catch (err: any) {
      alert('Erro ao salvar: ' + (err.message || 'Tente novamente'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (m: MunicipalityData) => {
    if (!confirm(`Remover ${m.name} - ${m.uf}?`)) return;
    try {
      if (m.id) await municipalitiesApi.delete(m.id);
      setMunicipalities(prev => prev.filter(x => !(x.name === m.name && x.uf === m.uf)));
    } catch (err: any) {
      alert('Erro ao remover: ' + (err.message || 'Tente novamente'));
    }
  };

  const ufCounts = municipalities.reduce((acc, m) => {
    acc[m.uf] = (acc[m.uf] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <MapPin className="text-indigo-950" size={26} />
            Municípios Cadastrados
          </h2>
          <p className="text-sm text-slate-500">
            {municipalities.length} municípios registrados em {Object.keys(ufCounts).length} estados.
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold uppercase tracking-wider hover:bg-indigo-950 transition-colors shadow-sm cursor-pointer"
        >
          <Plus size={16} />
          Novo Município
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Buscar município..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          />
        </div>
        <select
          value={selectedUf}
          onChange={(e) => setSelectedUf(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
        >
          <option value="">Todas as UFs</option>
          {BRAZILIAN_STATES.filter(uf => ufCounts[uf]).map(uf => (
            <option key={uf} value={uf}>{uf} ({ufCounts[uf]})</option>
          ))}
        </select>
      </div>

      {/* Municipalities Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredMunicipalities.map((m, idx) => (
              <div key={idx} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow group">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">{m.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {m.uf} · {getRegionForUf(m.uf)}
                </p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleEdit({ name: m.name, uf: m.uf, id: 0, demands_count: 0, total_value: 0, schools_count: 0, population: 0, hdi: 0, region: getRegionForUf(m.uf) as any })}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleDelete({ name: m.name, uf: m.uf, id: 0, demands_count: 0, total_value: 0, schools_count: 0, population: 0, hdi: 0, region: getRegionForUf(m.uf) as any })}
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
        <div className="text-center py-12 bg-white border border-slate-100 rounded-2xl">
          <MapPin className="mx-auto text-slate-300 mb-3" size={32} />
          <p className="text-sm text-slate-500 font-semibold">Nenhum município encontrado</p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fade-in">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-900">
                {editingMunicipality ? 'Editar Município' : 'Novo Município'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Nome do Município *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Petrolina"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">UF *</label>
                <select
                  value={formUf}
                  onChange={(e) => setFormUf(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                >
                  {BRAZILIAN_STATES.map(uf => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !formName.trim()}
                className="flex-1 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-indigo-950 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingMunicipality ? 'Atualizar' : 'Cadastrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import NewDemandView from './components/NewDemandView';
import DemandsView from './components/DemandsView';
import MunicipalitiesView from './components/MunicipalitiesView';
import ReportsView from './components/ReportsView';
import SettingsView from './components/SettingsView';
import LoginView from './components/LoginView';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Demand, MunicipalityData } from './types';
import { demandsApi, municipalitiesApi } from './services/api';

function AppContent() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  
  // App States
  const [demands, setDemands] = useState<Demand[]>([]);
  const [municipalities, setMunicipalities] = useState<MunicipalityData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [selectedDemandFromDashboard, setSelectedDemandFromDashboard] = useState<Demand | null>(null);

  // Load data on mount (only when authenticated)
  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const [demandsData, municipalitiesData] = await Promise.all([
        demandsApi.getAll({ limit: 100 }),
        municipalitiesApi.getAll()
      ]);
      
      setDemands(demandsData.data);
      setMunicipalities(municipalitiesData);
    } catch (err: any) {
      console.error('Error loading data:', err);
      setError(err.message || 'Erro ao carregar dados');
    } finally {
      setIsLoading(false);
    }
  };

  // Callbacks
  const handleAddDemand = (newDemand: Demand) => {
    setDemands(prev => [newDemand, ...prev]);
  };

  const handleUpdateDemand = (updatedDemand: Demand) => {
    setDemands(prev => prev.map(d => d.id === updatedDemand.id ? updatedDemand : d));
  };

  const handleSelectDemandFromDashboard = (demand: Demand) => {
    setSelectedDemandFromDashboard(demand);
    setActiveTab('demands');
  };

  const handleNavigateToTab = (tab: string) => {
    setActiveTab(tab);
  };

  // Pending demands count
  const pendingTriageCount = demands.filter(d => d.status === 'pendente').length;

  // Show login if not authenticated
  if (!isAuthenticated) {
    return (
      <LoginView onNavigateToTab={handleNavigateToTab} />
    );
  }

  // Show loading state
  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-slate-900 border-t-indigo-500 rounded-full animate-spin"></div>
        <p className="text-xs font-semibold text-slate-500 font-mono">SGD • Carregando sistema...</p>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-bold text-slate-800">Erro ao inicializar o sistema</h2>
          <p className="text-sm text-slate-500">{error}</p>
          <button
            onClick={loadData}
            className="px-6 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-800 font-sans" id="sgm-shell">
      {/* Top Corporate Line */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-indigo-600 z-50" />

      {/* Navigation Sidebar */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen}
        pendingCount={pendingTriageCount}
      />

      {/* Main View Workspace */}
      <main className="flex-1 min-w-0 lg:pl-64 pt-6 px-4 md:px-8 pb-12">
        <div className="max-w-7xl mx-auto py-8">
          {activeTab === 'dashboard' && (
            <DashboardView 
              onNavigateToTab={handleNavigateToTab}
              onSelectDemand={handleSelectDemandFromDashboard}
            />
          )}

          {activeTab === 'new-demand' && (
            <NewDemandView 
              municipalities={municipalities}
              onAddDemand={handleAddDemand}
              onNavigateToTab={handleNavigateToTab}
            />
          )}

          {activeTab === 'demands' && (
            <DemandsView 
              demands={demands}
              selectedDemandFromDashboard={selectedDemandFromDashboard}
              clearSelectedDemandFromDashboard={() => setSelectedDemandFromDashboard(null)}
              onUpdateDemand={handleUpdateDemand}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'login' && (
            <LoginView 
              onNavigateToTab={handleNavigateToTab}
            />
          )}

          {activeTab === 'municipalities' && (
            <MunicipalitiesView 
              municipalities={municipalities}
              setMunicipalities={setMunicipalities}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsView 
              demands={demands}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView onBackToLogin={() => {
              localStorage.removeItem('authToken');
              window.location.reload();
            }} />
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
import React, { useState, useEffect, Suspense, lazy } from 'react';
import Sidebar from './components/Sidebar';
import DemandsView from './components/DemandsView';
import LoginView from './components/LoginView';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { Demand, MunicipalityData } from './types';
import { demandsApi, municipalitiesApi } from './services/api';
import { Skeleton } from './components/ui/Skeleton';

const DashboardView = lazy(() => import('./components/DashboardView'));
const NewDemandView = lazy(() => import('./components/NewDemandView'));
const MunicipalitiesView = lazy(() => import('./components/MunicipalitiesView'));
const ReportsView = lazy(() => import('./components/ReportsView'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const UsersView = lazy(() => import('./components/UsersView'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const AuditView = lazy(() => import('./components/AuditView'));
const IntegrationView = lazy(() => import('./components/IntegrationView'));
const BackupView = lazy(() => import('./components/BackupView'));

function ViewFallback() {
  return (
    <div className="min-h-[400px] p-8 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-5 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="bg-white dark:bg-[#111a2e] border border-slate-100 dark:border-slate-700/50 rounded-2xl p-6 space-y-4">
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AppContent() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  
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
        demandsApi.getAll({ limit: 999 }),
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

  const handleDeleteDemand = (id: string) => {
    setDemands(prev => prev.filter(d => d.id !== id));
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
        <p className="text-xs font-semibold text-slate-500 font-mono">CGASI.SE • Carregando...</p>
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
      <main className="flex-1 min-w-0 lg:pl-72 pt-6 px-4 md:px-8 pb-12">
        <div className="max-w-7xl mx-auto py-8">
          {activeTab === 'dashboard' && (
            <Suspense fallback={<ViewFallback />}>
              <DashboardView
                onNavigateToTab={handleNavigateToTab}
                onSelectDemand={handleSelectDemandFromDashboard}
              />
            </Suspense>
          )}

          {activeTab === 'new-demand' && (
            <Suspense fallback={<ViewFallback />}>
              <NewDemandView
                municipalities={municipalities}
                onAddDemand={handleAddDemand}
                onNavigateToTab={handleNavigateToTab}
              />
            </Suspense>
          )}

          {activeTab === 'demands' && (
            <DemandsView
              demands={demands}
              selectedDemandFromDashboard={selectedDemandFromDashboard}
              clearSelectedDemandFromDashboard={() => setSelectedDemandFromDashboard(null)}
              onUpdateDemand={handleUpdateDemand}
              onAddDemand={handleAddDemand}
              onDeleteDemand={handleDeleteDemand}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'login' && (
            <LoginView
              onNavigateToTab={handleNavigateToTab}
            />
          )}

          {activeTab === 'municipalities' && (
            <Suspense fallback={<ViewFallback />}>
              <MunicipalitiesView
                municipalities={municipalities}
                setMunicipalities={setMunicipalities}
              />
            </Suspense>
          )}

          {activeTab === 'reports' && (
            <Suspense fallback={<ViewFallback />}>
              <ReportsView
                demands={demands}
              />
            </Suspense>
          )}

          {activeTab === 'settings' && (
            <Suspense fallback={<ViewFallback />}>
              <SettingsView onBackToLogin={() => {
                localStorage.removeItem('authToken');
                window.location.reload();
              }} />
            </Suspense>
          )}

          {activeTab === 'users' && (
            <Suspense fallback={<ViewFallback />}>
              <UsersView currentUser={user!} />
            </Suspense>
          )}

          {activeTab === 'calendar' && (
            <Suspense fallback={<ViewFallback />}>
              <CalendarView />
            </Suspense>
          )}

          {activeTab === 'audit' && (
            <Suspense fallback={<ViewFallback />}>
              <AuditView />
            </Suspense>
          )}

          {activeTab === 'integrations' && (
            <Suspense fallback={<ViewFallback />}>
              <IntegrationView />
            </Suspense>
          )}

          {activeTab === 'backup' && (
            <Suspense fallback={<ViewFallback />}>
              <BackupView />
            </Suspense>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}
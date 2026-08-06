import React, { useState, useEffect, Suspense, lazy, useCallback } from 'react';
import Sidebar from './components/layout/Sidebar';
import { Header } from './components/ui/Header';
import DemandsView from './components/views/DemandsView';
import LoginView from './components/views/LoginView';
import ResetPasswordView from './components/views/ResetPasswordView';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { Demand, MunicipalityData } from './types';
import { demandsApi, municipalitiesApi } from './services/api';
import { DemandsNavFilters } from './components/views/DemandsView';
import { Skeleton } from './components/ui/Skeleton';
import { Spinner } from './components/ui/Spinner';
import ErrorBoundary from './components/ui/ErrorBoundary';

const DashboardView = lazy(() => import('./components/views/DashboardView'));
const NewDemandView = lazy(() => import('./components/views/NewDemandView'));
const MunicipalitiesView = lazy(() => import('./components/views/MunicipalitiesView'));
const ReportsView = lazy(() => import('./components/views/ReportsView'));
const SettingsView = lazy(() => import('./components/views/SettingsView'));
const UsersView = lazy(() => import('./components/views/UsersView'));
const CalendarView = lazy(() => import('./components/views/CalendarView'));
const AuditView = lazy(() => import('./components/views/AuditView'));
const AuditDashboardView = lazy(() => import('./components/views/AuditDashboardView'));
const IntegrationView = lazy(() => import('./components/views/IntegrationView'));
const SessionsView = lazy(() => import('./components/views/SessionsView'));
const BackupManagementView = lazy(() => import('./components/views/BackupManagementView'));
const MonitoringView = lazy(() => import('./components/views/MonitoringView'));
const LgpdView = lazy(() => import('./components/views/LgpdView'));
const ExecutivePanelView = lazy(() => import('./components/views/ExecutivePanelView'));
const InactivityWrapper = lazy(() => import('./components/layout/InactivityWrapper'));

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
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();

  // App States
  const [demands, setDemands] = useState<Demand[]>([]);
  const [municipalities, setMunicipalities] = useState<MunicipalityData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [selectedDemandFromDashboard, setSelectedDemandFromDashboard] = useState<Demand | null>(null);
  const [demandNavFilters, setDemandNavFilters] = useState<DemandsNavFilters | null>(null);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const loadData = useCallback(async () => {
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
      setError(err?.message || 'Erro ao carregar dados');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, loadData]);

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

  /** Abre a página de Demandas já filtrada (ex.: clique em município/estado). */
  const handleOpenDemandsWithFilters = (filters: DemandsNavFilters) => {
    setDemandNavFilters({ municipality: filters.municipality, uf: filters.uf, status: filters.status });
    setActiveTab('demands');
  };

  const handleNavigateToTab = (tab: string) => {
    if (tab === 'reset-password') { setShowResetPassword(true); return; }
    setActiveTab(tab);
  };

  const pendingTriageCount = demands.filter(d => d.status === 'pendente').length;

  // Show login if not authenticated
  if (!isAuthenticated) {
    if (showResetPassword) {
      return <ResetPasswordView onBack={() => setShowResetPassword(false)} />;
    }
    return (
      <LoginView onNavigateToTab={handleNavigateToTab} />
    );
  }

  // Show loading state
  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-[#0a1628] dark:to-[#0b1120] flex flex-col items-center justify-center gap-4">
        <Spinner size={48} className="text-gov-700 dark:text-gov-500" />
        <div className="text-center">
          <div className="flex items-baseline gap-1 justify-center">
            <p className="text-base font-extrabold tracking-tight text-gov-900 dark:text-white">CGASI</p>
            <p className="text-base font-bold tracking-tight text-gov-500 dark:text-gold">.SE</p>
          </div>
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 mt-0.5">Carregando...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-[#0a1628] dark:to-[#0b1120] flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">Erro ao inicializar o sistema</h2>
          <p className="text-sm text-slate-500">{error}</p>
          <button
            onClick={loadData}
            className="px-6 py-2.5 rounded-xl bg-gov-700 hover:bg-gov-800 text-white text-sm font-bold transition-colors shadow-sm"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const content = (
    <div className="min-h-screen flex text-slate-800 font-sans" id="sgm-shell">
      <div className="fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-gov-700 via-gov-500 to-gov-700 z-50" />

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        pendingCount={pendingTriageCount}
      />

      <div className="flex-1 flex flex-col min-w-0 lg:pl-72">
        <Header
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isSidebarOpen={isSidebarOpen}
          pendingCount={pendingTriageCount}
        />
        <main className="flex-1 px-4 md:px-8 pb-12 pt-4">
          <div className="max-w-7xl mx-auto">
          {activeTab === 'dashboard' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <DashboardView
                onNavigateToTab={handleNavigateToTab}
                onSelectDemand={handleSelectDemandFromDashboard}
                onOpenDemands={handleOpenDemandsWithFilters}
              />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'executive-panel' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <ExecutivePanelView onOpenDemands={handleOpenDemandsWithFilters} />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'new-demand' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <NewDemandView
                municipalities={municipalities}
                onAddDemand={handleAddDemand}
                onNavigateToTab={handleNavigateToTab}
              />
            </Suspense></ErrorBoundary>
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
              onNavigateToTab={handleNavigateToTab}
              initialFilters={demandNavFilters}
              onFiltersConsumed={() => setDemandNavFilters(null)}
            />
          )}

          {activeTab === 'login' && (
            <LoginView
              onNavigateToTab={handleNavigateToTab}
            />
          )}

          {activeTab === 'municipalities' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <MunicipalitiesView
                municipalities={municipalities}
                setMunicipalities={setMunicipalities}
              />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'reports' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <ReportsView demands={demands} />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'settings' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <SettingsView onBackToLogin={() => {
                logout();
              }} />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'users' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <UsersView currentUser={user!} />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'calendar' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <CalendarView onOpenDemand={(id) => {
                const d = demands.find(x => x.id === id);
                if (d) handleSelectDemandFromDashboard(d);
                else setActiveTab('demands');
              }} />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'audit' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <AuditView />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'audit-dashboard' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <AuditDashboardView />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'integrations' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <IntegrationView />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'sessions' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <SessionsView />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'backup' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <BackupManagementView />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'monitoring' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <MonitoringView />
            </Suspense></ErrorBoundary>
          )}

          {activeTab === 'lgpd' && (
            <ErrorBoundary><Suspense fallback={<ViewFallback />}>
              <LgpdView />
            </Suspense></ErrorBoundary>
          )}
        </div>
      </main>
      </div>
    </div>
  );

  return (
    <InactivityWrapper onLogout={logout}>
      {content}
    </InactivityWrapper>
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

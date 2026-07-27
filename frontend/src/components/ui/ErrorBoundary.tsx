import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.hash = '#/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-8 max-w-md w-full text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertTriangle size={28} className="text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Algo deu errado</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Ocorreu um erro inesperado ao carregar esta seção.
              </p>
            </div>
            {this.state.error && (
              <details className="text-left">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                  Detalhes do erro
                </summary>
                <pre className="mt-2 text-[10px] font-mono text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-3 rounded-lg overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={this.handleGoHome}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <Home size={14} />
                Voltar ao Dashboard
              </button>
              <button
                onClick={this.handleReset}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                <RefreshCw size={14} />
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

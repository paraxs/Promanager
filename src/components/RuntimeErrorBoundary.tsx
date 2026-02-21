import type { ReactNode } from 'react';
import { Component } from 'react';
import { APP_CONFIG } from '../config/appConfig';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class RuntimeErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('RuntimeErrorBoundary', error);
  }

  private resetLocalData = () => {
    try {
      localStorage.removeItem(APP_CONFIG.persistence.boardStorageKey);
      localStorage.removeItem(APP_CONFIG.persistence.dashboardLabelStorageKey);
      localStorage.removeItem(APP_CONFIG.persistence.dashboardSubtitleStorageKey);
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-red-50 p-4 text-red-900 sm:p-6">
        <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-white p-4 shadow-sm sm:p-6">
          <h1 className="text-xl font-bold">Runtime-Fehler erkannt</h1>
          <p className="mt-2 text-sm text-red-700">
            Die Anwendung konnte nicht korrekt geladen werden. Details:
          </p>
          <pre className="mt-3 overflow-auto rounded-lg bg-red-950/90 p-3 text-xs text-red-100">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.resetLocalData}
              className="rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-200"
            >
              Lokale Daten zuruecksetzen und neu laden
            </button>
          </div>
        </div>
      </div>
    );
  }
}

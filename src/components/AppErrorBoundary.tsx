import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Startup] The app screen failed to render:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-primary px-5 py-10 text-white">
          <section className="w-full max-w-md rounded-2xl bg-white p-6 text-center text-gray-900 shadow-xl">
            <h1 className="text-xl font-bold">Adimat could not load this screen</h1>
            <p className="mt-2 text-sm text-gray-600">Reload the app to try again.</p>
            <p className="mt-3 break-words rounded-lg bg-gray-100 p-3 text-left font-mono text-xs text-gray-700" role="alert">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl bg-primary px-5 py-3 font-semibold text-white touch-target"
            >
              Reload app
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

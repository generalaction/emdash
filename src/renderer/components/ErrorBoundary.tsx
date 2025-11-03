import React from 'react';

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

type ErrorBoundaryProps = { children?: React.ReactNode };

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      // Best-effort: log to app logger if available
      void import('../lib/logger').then(({ log }) => {
        try {
          log.error('Renderer crash caught by ErrorBoundary', { error, info });
        } catch {}
      });
    } catch {}
  }

  handleReload = () => {
    try {
      window.location.reload();
    } catch {}
  };

  render() {
    if (!this.state.hasError) return this.props.children as React.ReactElement;

    const message = this.state.error?.message || 'An unexpected error occurred.';

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
        <div className="max-w-xl rounded-md border border-border bg-card p-6 text-card-foreground shadow-sm">
          <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
          <p className="mb-4 break-all text-sm text-muted-foreground">{message}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm"
              onClick={this.handleReload}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

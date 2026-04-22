import React from 'react';
import { captureComponentError } from '../../_legacy/errorTracking';
import { rpc } from '../ipc';
import { Button } from '../ui/button';

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

type ErrorBoundaryProps = {
  children?: React.ReactNode;
  componentName?: string;
};

function ErrorFallback({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
      <div className="max-w-xl rounded-md border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
        <p className="mb-4 break-all text-sm text-muted-foreground">{message}</p>
        <Button variant="default" onClick={onReload}>
          Reload
        </Button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      // Track error with PostHog
      captureComponentError(error, this.props.componentName || 'App', {
        component_stack: info.componentStack,
        error_boundary: true,
        severity: 'critical',
      });
    } catch {}
  }

  handleReload = () => {
    void rpc.viewState.reset().finally(() => {
      try {
        window.location.reload();
      } catch {}
    });
  };

  render() {
    if (!this.state.hasError) return this.props.children as React.ReactElement;
    const message = this.state.error?.message || 'An unexpected error occurred.';
    return <ErrorFallback message={message} onReload={this.handleReload} />;
  }
}

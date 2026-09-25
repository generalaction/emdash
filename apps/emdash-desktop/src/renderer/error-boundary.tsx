import { Button, Collapsible } from '@emdash/ui/react/primitives';
import { ChevronRight, RotateCw } from 'lucide-react';
import React from 'react';
import { getMementoClient } from '@core/primitives/mementos/browser';

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
  isRecovering: boolean;
  recoveryError: string | null;
};

type ErrorBoundaryProps = {
  children?: React.ReactNode;
};

function ErrorFallback({
  message,
  onReload,
  onReset,
  isRecovering,
  recoveryError,
}: {
  message: string;
  onReload: () => void;
  onReset: () => void;
  isRecovering: boolean;
  recoveryError: string | null;
}) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background-1 text-foreground shadow-sm">
        <div className="p-7">
          <h1 className="text-xl font-medium tracking-tight">Emdash couldn’t display that view</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Reload to try again with your saved layout.
          </p>
          <Button variant="primary" className="mt-6" onClick={onReload} disabled={isRecovering}>
            <RotateCw className="size-3.5" aria-hidden />
            Reload app
          </Button>
          {recoveryError && (
            <p role="alert" className="mt-3 text-sm">
              {recoveryError}
            </p>
          )}
          <Collapsible.Root className="mt-4">
            <div className="-ml-2 w-fit">
              <Collapsible.Trigger hideChevron className="group">
                <span className="flex items-center gap-1 text-xs text-foreground-muted">
                  <ChevronRight
                    className="size-3 transition-transform group-data-[panel-open]:rotate-90"
                    aria-hidden
                  />
                  Error details
                </span>
              </Collapsible.Trigger>
            </div>
            <Collapsible.Panel>
              <pre className="mt-2 rounded-md border border-border bg-background-2 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground-muted">
                {message}
              </pre>
            </Collapsible.Panel>
          </Collapsible.Root>
        </div>
        <Collapsible.Root
          className="border-t border-border bg-background-2 px-7 py-3"
          disabled={isRecovering}
        >
          <div className="-ml-2 w-fit">
            <Collapsible.Trigger hideChevron className="group">
              <span className="flex items-center gap-1 text-sm">
                <ChevronRight
                  className="size-3 transition-transform group-data-[panel-open]:rotate-90"
                  aria-hidden
                />
                Still having trouble?
              </span>
            </Collapsible.Trigger>
          </div>
          <Collapsible.Panel>
            <p className="mt-2 text-xs leading-relaxed text-foreground-muted">
              Reset saved UI state to try a fresh layout. This clears layouts, navigation, project
              order, and unsent drafts. Projects, files, and saved conversations are kept.
            </p>
            <Button
              variant="destructive"
              className="mt-3 mb-1"
              onClick={onReset}
              disabled={isRecovering}
            >
              Reset UI state and reload
            </Button>
          </Collapsible.Panel>
        </Collapsible.Root>
      </div>
    </div>
  );
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private recovering = false;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, isRecovering: false, recoveryError: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  handleReload = () => {
    void this.recover(false);
  };

  handleReset = () => {
    void this.recover(true);
  };

  private async recover(resetUiState: boolean): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    this.setState({ isRecovering: true, recoveryError: null });
    try {
      const client = getMementoClient();
      if (resetUiState) {
        // Discard pending drafts before deleting saved state so beforeunload cannot restore it.
        await client.deleteAll();
      } else {
        await client.flush();
      }
    } catch {
      // Ordinary reload is best effort; a failed reset must remain visible and retryable.
      if (resetUiState) {
        this.recovering = false;
        this.setState({
          isRecovering: false,
          recoveryError: 'Could not reset UI state. Try again, or use Reload to restart the app.',
        });
        return;
      }
    }
    try {
      window.location.reload();
    } catch {
      this.recovering = false;
      this.setState({
        isRecovering: false,
        recoveryError: 'Could not reload the app. Try again.',
      });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children as React.ReactElement;
    const message = this.state.error?.message || 'An unexpected error occurred.';
    return (
      <ErrorFallback
        message={message}
        onReload={this.handleReload}
        onReset={this.handleReset}
        isRecovering={this.state.isRecovering}
        recoveryError={this.state.recoveryError}
      />
    );
  }
}

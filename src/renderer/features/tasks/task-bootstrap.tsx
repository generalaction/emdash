import { Loader2, X } from 'lucide-react';
import type { ReactNode } from 'react';

export function BootstrapSpinner({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
      <p className="text-xs font-mono text-foreground-muted">{message}</p>
    </div>
  );
}

export function BootstrapError({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-xs flex-col items-center text-center gap-2">
        <p className="text-sm font-medium font-mono text-foreground-destructive">{title}</p>
        {detail && <p className="text-xs font-mono text-foreground-muted">{detail}</p>}
      </div>
    </div>
  );
}

/**
 * Pure layout component for the PTY bootstrap view.
 * Renders the header bar (spinner + message + Skip button) and a flex slot
 * for children. Has no IPC or MobX dependencies — usable directly in stories.
 */
export function BootstrapPtyLayout({
  message,
  isSkipping,
  onSkip,
  children,
}: {
  message: string;
  isSkipping: boolean;
  onSkip: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col p-8 items-center justify-center w-full">
      <div className="border max-w-md min-h-[400px] w-full mt-4">
        {children ?? (
          <div className="flex-1 text-foreground-passive font-mono text-center items-center justify-center h-full flex">
            PTY
          </div>
        )}
      </div>
      <div></div>
      <div className="flex shrink-0 items-center gap-2 max-w-xs px-3 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-muted" />
        <p className="flex-1 text-xs font-mono text-foreground-muted">{message}</p>
      </div>
      <button
        onClick={onSkip}
        disabled={isSkipping}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <X className="h-3 w-3" />
        Skip
      </button>
    </div>
  );
}

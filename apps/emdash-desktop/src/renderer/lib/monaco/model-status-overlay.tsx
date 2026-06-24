import type { useModelStatus } from '@renderer/lib/monaco/use-model';
import { Spinner } from '@renderer/lib/ui/spinner';

export function ModelStatusOverlay({ status }: { status: ReturnType<typeof useModelStatus> }) {
  const message =
    status === 'error'
      ? 'Could not load file'
      : status === 'too-large'
        ? 'File too large to display in the editor'
        : 'Loading file...';

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background-secondary-1 text-xs text-foreground-passive">
      <div className="flex items-center gap-2">
        {status === 'loading' ? <Spinner size="sm" /> : null}
        <span>{message}</span>
      </div>
    </div>
  );
}

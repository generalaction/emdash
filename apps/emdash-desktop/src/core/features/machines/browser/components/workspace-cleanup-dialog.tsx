import { Button, Checkbox, Dialog, toast } from '@emdash/ui/react/primitives';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getWorkspaceRegistryWireClient } from '@core/features/workspaces/api/browser/client';
import { useModalController } from '@core/manifests/browser/modal-api';
import { formatBytes } from '@core/primitives/formatting/browser/formatBytes';
import { defineModal } from '@core/primitives/modals/react';

const CLEANUP_PREVIEW_QUERY_KEY = ['workspaceCleanupPreview'] as const;

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Previews and runs "Clean up": untracks missing worktrees that no open task needs and
 * compacts the app database. Counts come from the main process before anything runs.
 */
export function WorkspaceCleanupDialog() {
  const controller = useModalController('workspaceCleanupModal');
  const preview = useQuery({
    queryKey: CLEANUP_PREVIEW_QUERY_KEY,
    queryFn: async () => (await getWorkspaceRegistryWireClient()).getCleanupPreview(),
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  const missing = preview.data?.missingWorktrees ?? [];
  const freeBytes = preview.data?.database.freeBytes ?? 0;

  const [untrackMissing, setUntrackMissing] = useState(false);
  const [compact, setCompact] = useState(false);
  const [showPaths, setShowPaths] = useState(false);

  // Default each step on once the preview shows it has something to do.
  useEffect(() => {
    if (!preview.data) return;
    setUntrackMissing(preview.data.missingWorktrees.length > 0);
    setCompact(preview.data.database.freeBytes > 0);
  }, [preview.data]);

  const run = useMutation({
    mutationFn: async () =>
      (await getWorkspaceRegistryWireClient()).runCleanup({
        untrackMissing,
        compactDatabase: compact,
      }),
    onSuccess: (result) => {
      if (result.success) {
        const parts = [
          untrackMissing ? `Untracked ${plural(result.data.untracked, 'missing worktree')}` : null,
          compact ? `freed ${formatBytes(result.data.freedBytes)}` : null,
        ].filter((part): part is string => part !== null);
        toast(parts.length > 0 ? `${parts.join(', ')}.` : 'Nothing to clean up.');
      } else {
        toast.error('Could not compact the database', {
          description:
            result.error.untracked > 0
              ? `${plural(result.error.untracked, 'missing worktree')} untracked. ${result.error.message}`
              : result.error.message,
        });
      }
      controller.complete(undefined);
    },
    onError: (error) => {
      toast.error('Clean up failed', {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const nothingSelected = !untrackMissing && !compact;

  return (
    <>
      <Dialog.Header showCloseButton={false}>
        <Dialog.Title>Clean up</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="flex flex-col gap-4 pt-0 text-sm">
        <p className="text-foreground-muted">
          Clears leftovers across all machines. Files and branches on disk are not touched.
        </p>
        {preview.isLoading ? (
          <p className="text-foreground-muted">Checking what can be cleaned up…</p>
        ) : preview.isError ? (
          <p className="text-foreground-destructive">Could not load the cleanup preview.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={untrackMissing}
                  disabled={missing.length === 0 || run.isPending}
                  onCheckedChange={(value) => setUntrackMissing(Boolean(value))}
                />
                Untrack {plural(missing.length, 'missing worktree')}
              </label>
              <p className="pl-6 text-xs text-foreground-muted">
                Worktrees whose folder is gone and whose tasks are all archived or deleted.
                {missing.length > 0 && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setShowPaths((value) => !value)}
                    >
                      {showPaths ? 'Hide' : 'Show'}
                    </button>
                  </>
                )}
              </p>
              {showPaths && (
                <ul className="max-h-40 overflow-auto pl-6 font-mono text-xs text-foreground-muted">
                  {missing.map((row) => (
                    <li key={row.workspaceId} className="truncate" title={row.path ?? undefined}>
                      {row.path ?? row.workspaceId}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={compact}
                  disabled={freeBytes === 0 || run.isPending}
                  onCheckedChange={(value) => setCompact(Boolean(value))}
                />
                Compact database (frees ~{formatBytes(freeBytes)})
              </label>
              <p className="pl-6 text-xs text-foreground-muted">
                Emdash may pause briefly while the database is rebuilt.
              </p>
            </div>
          </>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" disabled={run.isPending} onClick={controller.dismiss}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!preview.data || nothingSelected || run.isPending}
          onClick={() => run.mutate()}
        >
          {run.isPending ? 'Cleaning up…' : 'Clean up'}
        </Button>
      </Dialog.Footer>
    </>
  );
}

export const workspaceCleanupModal = defineModal<undefined>()({
  id: 'workspaceCleanupModal',
  component: WorkspaceCleanupDialog,
  size: 'xs',
});

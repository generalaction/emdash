import type { GitChange } from '@emdash/core/runtimes/git/api';
import { Button, toast } from '@emdash/ui/react/primitives';
import { Check, Plus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import { formatErrorType } from '@core/features/tasks/api/browser/utils';
import {
  useTaskComposition,
  useWorkspace,
} from '@core/features/workbench/api/browser/task-composition-context';
import { resolveWorkspacePath } from '@core/features/workspaces/api/browser/workspace-path';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { ChangesListItem, RowAction } from './components/changes-list-item';
import { SectionHeader } from './components/section-header';

const OPERATION_LABEL = {
  merge: 'Merging',
  rebase: 'Rebasing',
  'cherry-pick': 'Cherry-picking',
  revert: 'Reverting',
} as const;

/** Conflicted files plus Continue/Abort while a merge-like operation is in progress. */
export const MergeChangesSection = observer(function MergeChangesSection() {
  const workspace = useWorkspace();
  const taskView = useTaskComposition();
  const git = workspace.get(gitCheckoutStoreToken);
  const openConfirmActionModal = useOpenModal('confirmActionModal');
  const [busy, setBusy] = useState(false);
  const operation = git.resolvableOperation;
  const conflicts = git.conflictedChanges;

  if (!operation && conflicts.length === 0) return null;

  /** The file editor highlights conflict blocks and offers Accept Current/Incoming/Both lenses. */
  const openConflict = (change: GitChange, preview: boolean) =>
    taskView.activePane.open(
      'file',
      { path: resolveWorkspacePath(workspace.path, change.path) },
      { preview }
    );

  const run = async (action: () => ReturnType<typeof git.continueOperation>, label: string) => {
    setBusy(true);
    try {
      const result = await action();
      if (!result.success) toast.error(`Failed to ${label}: ${formatErrorType(result.error)}`);
    } catch (error) {
      toast.error(`Failed to ${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAbort = () => {
    void (async () => {
      const outcome = await openConfirmActionModal({
        title: `Abort ${operation}`,
        variant: 'destructive',
        description: `Abort the ${operation} in progress? Your conflict resolutions will be lost.`,
      });
      if (outcome.success) await run(() => git.abortOperation(), `abort ${operation}`);
    })();
  };

  const markResolved = (path: string) => {
    void git.stageFiles([path]).then(
      (result) => {
        if (!result.success) toast.error(`Failed to stage: ${formatErrorType(result.error)}`);
      },
      (error: unknown) =>
        toast.error(`Failed to stage: ${error instanceof Error ? error.message : String(error)}`)
    );
  };

  return (
    <div className="flex max-h-[40%] shrink-0 flex-col border-b border-border">
      <SectionHeader label="Merge Changes" count={conflicts.length} />
      {operation && (
        <div className="flex items-center gap-1.5 px-3 pb-2">
          <span className="mr-auto truncate text-xs text-foreground-muted">
            {OPERATION_LABEL[operation]}
            {conflicts.length > 0 ? ' — resolve conflicts to continue' : ''}
          </span>
          <Button
            size="xs"
            disabled={busy || conflicts.length > 0}
            onClick={() => void run(() => git.continueOperation(), `continue ${operation}`)}
          >
            <Check className="size-3" />
            Continue
          </Button>
          <Button size="xs" variant="secondary" disabled={busy} onClick={handleAbort}>
            <X className="size-3" />
            Abort
          </Button>
        </div>
      )}
      <div className="min-h-0 overflow-y-auto px-1 pb-1">
        {conflicts.map((change) => (
          <ChangesListItem
            key={change.path}
            change={change}
            rootPath={workspace.path}
            onClick={() => openConflict(change, true)}
            onDoubleClick={() => openConflict(change, false)}
            rowActions={() => (
              <RowAction title="Mark as resolved (stage)" onClick={() => markResolved(change.path)}>
                <Plus className="size-3.5" />
              </RowAction>
            )}
          />
        ))}
      </div>
    </div>
  );
});

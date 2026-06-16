import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import type { TaskDeletePreflightItem } from '@shared/core/tasks/tasks';

export type DeleteTaskModalArgs = {
  projectId: string;
  tasks: Array<{ taskId: string; taskName: string }>;
};

export type DeleteTaskModalResult = {
  deleteWorktree: boolean;
  deleteBranch: boolean;
};

type Props = BaseModalProps<DeleteTaskModalResult> & DeleteTaskModalArgs;

export function DeleteTaskModal({ projectId, tasks, onSuccess, onClose }: Props) {
  const [preflight, setPreflight] = useState<TaskDeletePreflightItem[] | null>(null);
  const taskSettings = useTaskSettings();
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(true);

  const count = tasks.length;
  const isBulk = count > 1;

  // Stable taskIds string — props don't change after modal opens.
  const taskIds = useMemo(() => tasks.map((t) => t.taskId), [tasks]);

  useEffect(() => {
    rpc.tasks.getDeletePreflight(projectId, taskIds).then(
      (result) => setPreflight(result.tasks),
      // On error, allow the modal to proceed without preflight info (no checkboxes shown).
      () => setPreflight([])
    );
  }, [projectId, taskIds]);

  const askWhatToDelete = taskSettings.deleteBehavior === 'ask';
  const isLoading = preflight === null || taskSettings.loading;

  const worktreeTasks = preflight?.filter((t) => t.hasWorktree) ?? [];
  const dirtyTasks = preflight?.filter((t) => t.hasUncommittedChanges) ?? [];
  const branchTasks = preflight?.filter((t) => t.hasDeletableBranch) ?? [];

  const showWorktreeCheckbox = askWhatToDelete && !isLoading && worktreeTasks.length > 0;
  const showBranchCheckbox = askWhatToDelete && !isLoading && branchTasks.length > 0;

  const handleWorktreeChange = (checked: boolean) => {
    setDeleteWorktree(checked);
    if (!checked) setDeleteBranch(false);
  };

  const title = isBulk ? `Delete ${count} tasks` : 'Delete task';

  const description = isBulk
    ? `${count} tasks will be permanently deleted. This action cannot be undone.`
    : `"${tasks[0]!.taskName}" will be permanently deleted. This action cannot be undone.`;

  const worktreeLabel = isBulk
    ? `Delete worktrees (${worktreeTasks.length} of ${count} tasks)`
    : 'Delete worktree';

  const branchLabel = isBulk
    ? `Delete branches (${branchTasks.length} of ${count} tasks)`
    : `Delete branch`;

  const dirtyWarning = (() => {
    if (dirtyTasks.length === 0) return null;
    if (!isBulk) {
      return `"${tasks[0]!.taskName}" has uncommitted changes that will be lost.`;
    }
    const names = dirtyTasks
      .map((t) => `"${tasks.find((task) => task.taskId === t.taskId)?.taskName ?? t.taskId}"`)
      .join(', ');
    return `${dirtyTasks.length} ${dirtyTasks.length === 1 ? 'task has' : 'tasks have'} uncommitted changes that will be lost: ${names}`;
  })();

  const deleteScopeNotice = isBulk
    ? 'Worktrees and branches for these tasks will also be deleted.'
    : 'The worktree and branch for this task will also be deleted.';

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="flex flex-col gap-4 pt-0">
        <p className="text-sm text-foreground-muted">{description}</p>

        {!askWhatToDelete && <p className="text-xs text-foreground-muted">{deleteScopeNotice}</p>}

        {dirtyWarning && !askWhatToDelete && (
          <div className="flex items-start gap-1.5 rounded-md bg-background-warning px-3 py-2 text-xs text-foreground-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span>{dirtyWarning}</span>
          </div>
        )}

        {(showWorktreeCheckbox || showBranchCheckbox) && (
          <div className="flex flex-col gap-3">
            {showWorktreeCheckbox && (
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={deleteWorktree}
                    onCheckedChange={(checked) => handleWorktreeChange(Boolean(checked))}
                  />
                  {worktreeLabel}
                </label>
                {deleteWorktree && dirtyWarning && (
                  <div className="flex items-start gap-1.5 rounded-md bg-background-warning px-3 py-2 text-xs text-foreground-warning">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span>{dirtyWarning}</span>
                  </div>
                )}
              </div>
            )}

            {showBranchCheckbox && (
              <label
                className="flex cursor-pointer items-center gap-2 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                aria-disabled={!deleteWorktree}
              >
                <Checkbox
                  checked={deleteBranch}
                  onCheckedChange={(checked) => setDeleteBranch(Boolean(checked))}
                  disabled={!deleteWorktree}
                />
                {branchLabel}
              </label>
            )}
          </div>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton
          variant="destructive"
          disabled={isLoading}
          onClick={() =>
            onSuccess(
              askWhatToDelete
                ? { deleteWorktree, deleteBranch }
                : { deleteWorktree: true, deleteBranch: true }
            )
          }
        >
          {isLoading ? 'Loading...' : isBulk ? `Delete ${count} tasks` : 'Delete'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

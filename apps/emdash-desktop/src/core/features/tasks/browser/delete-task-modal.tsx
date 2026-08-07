import { Button, Checkbox, Dialog } from '@emdash/ui/react/primitives';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getTasksWireClient } from '@core/features/tasks/api/browser/client';
import { useTaskSettings } from '@core/features/tasks/api/browser/hooks/useTaskSettings';
import { useModalController } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';

export type DeleteTaskModalArgs = {
  projectId: string;
  tasks: Array<{ taskId: string; taskName: string }>;
};

export type DeleteTaskModalResult = {
  deleteWorktree: boolean;
  deleteBranch: boolean;
  deleteConversations: boolean;
};

export function DeleteTaskModal({ projectId, tasks }: DeleteTaskModalArgs) {
  const { complete, dismiss } = useModalController('deleteTaskModal');
  const { deleteBranchByDefault } = useTaskSettings();
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [deleteBranchOverride, setDeleteBranchOverride] = useState<boolean>();
  const [deleteConversations, setDeleteConversations] = useState(true);

  const count = tasks.length;
  const isBulk = count > 1;

  const taskIds = useMemo(() => tasks.map((t) => t.taskId), [tasks]);

  const { data: preflight = null } = useQuery({
    queryKey: ['deleteTaskPreflight', projectId, taskIds],
    staleTime: Infinity,
    queryFn: async () => {
      try {
        return (await (await getTasksWireClient()).getDeletePreflight({ projectId, taskIds }))
          .tasks;
      } catch {
        return [];
      }
    },
  });

  const isLoading = preflight === null;

  const worktreeTasks = preflight?.filter((t) => t.hasWorktree) ?? [];
  const dirtyTasks = preflight?.filter((t) => t.hasUncommittedChanges) ?? [];
  const branchTasks = preflight?.filter((t) => t.hasDeletableBranch) ?? [];
  // Nothing is queued for an unreachable host (ADR 0006): artifact deletion is
  // disabled with the reason shown, never silently deferred.
  const hostUnreachable = worktreeTasks.some((t) => t.hostReachable === false);

  const showWorktreeCheckbox = !isLoading && worktreeTasks.length > 0;
  const showBranchCheckbox = !isLoading && branchTasks.length > 0;
  const effectiveDeleteWorktree = deleteWorktree && !hostUnreachable;
  const effectiveDeleteBranch = deleteBranchOverride ?? deleteBranchByDefault;
  const shouldDeleteBranch = effectiveDeleteWorktree && effectiveDeleteBranch;

  const handleWorktreeChange = (checked: boolean) => {
    setDeleteWorktree(checked);
    if (!checked) setDeleteBranchOverride(undefined);
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
      const stats = dirtyTasks[0]?.changedLines;
      const lines =
        stats && (stats.added > 0 || stats.deleted > 0)
          ? ` (+${stats.added} −${stats.deleted})`
          : '';
      return `"${tasks[0]!.taskName}" has uncommitted changes${lines} that will be lost.`;
    }
    const names = dirtyTasks
      .map((t) => `"${tasks.find((task) => task.taskId === t.taskId)?.taskName ?? t.taskId}"`)
      .join(', ');
    return `${dirtyTasks.length} ${dirtyTasks.length === 1 ? 'task has' : 'tasks have'} uncommitted changes that will be lost: ${names}`;
  })();

  const unpushedWarning = (() => {
    const unpushed = worktreeTasks.filter((t) => (t.unpushedCommits ?? 0) > 0);
    if (unpushed.length === 0) return null;
    if (!isBulk) {
      const count = unpushed[0]!.unpushedCommits!;
      return `"${tasks[0]!.taskName}" has ${count} unpushed ${count === 1 ? 'commit' : 'commits'}.`;
    }
    return `${unpushed.length} ${unpushed.length === 1 ? 'task has' : 'tasks have'} unpushed commits.`;
  })();

  return (
    <>
      <Dialog.Header showCloseButton={false}>
        <Dialog.Title>{title}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="flex flex-col gap-4 pt-0">
        <p className="text-sm text-foreground-muted">{description}</p>

        {(showWorktreeCheckbox || showBranchCheckbox) && (
          <div className="flex flex-col gap-3">
            {showWorktreeCheckbox && (
              <div className="flex flex-col gap-2">
                <label
                  className="flex cursor-pointer items-center gap-2 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  aria-disabled={hostUnreachable}
                >
                  <Checkbox
                    checked={effectiveDeleteWorktree}
                    onCheckedChange={(checked) => handleWorktreeChange(Boolean(checked))}
                    disabled={hostUnreachable}
                  />
                  {worktreeLabel}
                </label>
                {hostUnreachable && (
                  <div className="flex items-start gap-1.5 rounded-md bg-background-warning px-3 py-2 text-xs text-foreground-warning">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span>
                      The host is unreachable, so the worktree cannot be deleted right now. The task
                      record will be removed; delete the worktree later from the workspaces view.
                    </span>
                  </div>
                )}
                {effectiveDeleteWorktree && dirtyWarning && (
                  <div className="flex items-start gap-1.5 rounded-md bg-background-warning px-3 py-2 text-xs text-foreground-warning">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span>{dirtyWarning}</span>
                  </div>
                )}
                {effectiveDeleteWorktree && unpushedWarning && (
                  <div className="flex items-start gap-1.5 rounded-md bg-background-warning px-3 py-2 text-xs text-foreground-warning">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    <span>{unpushedWarning}</span>
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
                  checked={shouldDeleteBranch}
                  onCheckedChange={(checked) => setDeleteBranchOverride(Boolean(checked))}
                  disabled={!deleteWorktree}
                />
                {branchLabel}
              </label>
            )}
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={deleteConversations}
            onCheckedChange={(checked) => setDeleteConversations(Boolean(checked))}
          />
          Delete conversations
        </label>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={dismiss}>
          Cancel
        </Button>
        <ConfirmButton
          variant="destructive"
          disabled={isLoading}
          onClick={() =>
            complete({
              deleteWorktree: effectiveDeleteWorktree,
              deleteBranch: showBranchCheckbox && shouldDeleteBranch,
              deleteConversations,
            })
          }
        >
          {isLoading ? 'Loading...' : isBulk ? `Delete ${count} tasks` : 'Delete'}
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
}

export const deleteTaskModal = defineModal<DeleteTaskModalResult>()({
  id: 'deleteTaskModal',
  component: DeleteTaskModal,
  size: 'sm',
});

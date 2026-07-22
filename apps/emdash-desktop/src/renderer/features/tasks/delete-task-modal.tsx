import { useQuery } from '@tanstack/react-query';
import { InfoIcon, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { useTaskSettings } from './hooks/useTaskSettings';

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
  const { deleteBranchByDefault } = useTaskSettings();
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [deleteBranchOverride, setDeleteBranchOverride] = useState<boolean>();

  const count = tasks.length;
  const isBulk = count > 1;

  const taskIds = useMemo(() => tasks.map((t) => t.taskId), [tasks]);

  const { data: preflight = null } = useQuery({
    queryKey: ['deleteTaskPreflight', projectId, taskIds],
    staleTime: Infinity,
    queryFn: async () => {
      try {
        return (await rpc.tasks.getDeletePreflight(projectId, taskIds)).tasks;
      } catch {
        return [];
      }
    },
  });

  const isLoading = preflight === null;

  const worktreeTasks = preflight?.filter((t) => t.hasWorktree) ?? [];
  const dirtyTasks = preflight?.filter((t) => t.hasUncommittedChanges) ?? [];
  const branchTasks = preflight?.filter((t) => t.hasDeletableBranch) ?? [];

  const showWorktreeCheckbox = !isLoading && worktreeTasks.length > 0;
  const showBranchCheckbox = !isLoading && branchTasks.length > 0;
  const effectiveDeleteBranch = deleteBranchOverride ?? deleteBranchByDefault;
  const shouldDeleteBranch = deleteWorktree && effectiveDeleteBranch;

  const handleWorktreeChange = (checked: boolean) => {
    setDeleteWorktree(checked);
    if (!checked) setDeleteBranchOverride(undefined);
  };

  const title = isBulk ? `Delete ${count} tasks` : 'Delete task';

  const description = isBulk
    ? `${count} tasks will be permanently removed from Emdash. This cannot be undone. Choose whether to also delete their local Git assets.`
    : `"${tasks[0]!.taskName}" will be permanently removed from Emdash. This cannot be undone. Choose whether to also delete its local Git assets.`;

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

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="flex flex-col gap-4 pt-0">
        <p className="text-sm text-foreground-muted">{description}</p>

        {(showWorktreeCheckbox || showBranchCheckbox) && (
          <div className="flex flex-col gap-3">
            {showWorktreeCheckbox && (
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={deleteWorktree}
                    onCheckedChange={(checked) => handleWorktreeChange(Boolean(checked))}
                  />
                  <span>{worktreeLabel}</span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={(e) => e.preventDefault()}
                          aria-label="About worktree deletion"
                          className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-foreground-passive transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:text-foreground focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-primary/30"
                        >
                          <InfoIcon className="size-3.5" aria-hidden="true" />
                        </button>
                      }
                    />
                    <TooltipContent className="max-w-[240px] items-start text-left leading-relaxed whitespace-normal">
                      Removes the local worktree and its files. Leave unchecked to keep them on
                      disk.
                    </TooltipContent>
                  </Tooltip>
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
                  checked={shouldDeleteBranch}
                  onCheckedChange={(checked) => setDeleteBranchOverride(Boolean(checked))}
                  disabled={!deleteWorktree}
                />
                <span>{branchLabel}</span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        aria-label="About branch deletion"
                        className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-foreground-passive transition-colors before:absolute before:-inset-2.5 before:content-[''] hover:text-foreground focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-primary/30"
                      >
                        <InfoIcon className="size-3.5" aria-hidden="true" />
                      </button>
                    }
                  />
                  <TooltipContent className="max-w-[240px] items-start text-left leading-relaxed whitespace-normal">
                    Deletes the local branch after removing its worktree. The remote branch is kept.
                  </TooltipContent>
                </Tooltip>
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
            onSuccess({
              deleteWorktree,
              deleteBranch: showBranchCheckbox && shouldDeleteBranch,
            })
          }
        >
          {isLoading ? 'Loading...' : isBulk ? `Delete ${count} tasks` : 'Delete'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

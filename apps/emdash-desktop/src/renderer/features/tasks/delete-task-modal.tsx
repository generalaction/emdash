import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  tasks: Array<{ taskId: string; taskName: string; hasKnownUncommittedChanges?: boolean }>;
};

export type DeleteTaskModalResult = {
  deleteWorktree: boolean;
  deleteBranch: boolean;
};

type Props = BaseModalProps<DeleteTaskModalResult> & DeleteTaskModalArgs;

export function DeleteTaskModal({ projectId, tasks, onSuccess, onClose }: Props) {
  const [preflight, setPreflight] = useState<TaskDeletePreflightItem[] | null>(null);
  const [deleteWorktree, setDeleteWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [isResolvingDelete, setIsResolvingDelete] = useState(false);
  const [needsDirtyConfirm, setNeedsDirtyConfirm] = useState(false);
  const preflightPromiseRef = useRef<Promise<TaskDeletePreflightItem[]> | null>(null);

  const count = tasks.length;
  const isBulk = count > 1;

  // Stable taskIds string — props don't change after modal opens.
  const taskIds = useMemo(() => tasks.map((t) => t.taskId), [tasks]);

  useEffect(() => {
    const promise = rpc.tasks.getDeletePreflight(projectId, taskIds).then(
      (result) => result.tasks,
      // On error, allow the modal to proceed without preflight info.
      () => []
    );
    preflightPromiseRef.current = promise;
    void promise.then((items) => setPreflight(items));
  }, [projectId, taskIds]);

  const isLoading = preflight === null;

  const worktreeTasks = preflight?.filter((t) => t.hasWorktree) ?? [];
  const dirtyTasksFor = (items: TaskDeletePreflightItem[] | null) => {
    const dirtyTaskIds = new Set(
      tasks.filter((t) => t.hasKnownUncommittedChanges).map((t) => t.taskId)
    );
    for (const task of items ?? []) {
      if (task.hasUncommittedChanges) dirtyTaskIds.add(task.taskId);
    }
    return tasks.filter((t) => dirtyTaskIds.has(t.taskId));
  };
  const dirtyTasks = dirtyTasksFor(preflight);
  const branchTasks = preflight?.filter((t) => t.hasDeletableBranch) ?? [];

  const showWorktreeCheckbox = !isLoading && worktreeTasks.length > 0;
  const showBranchCheckbox = !isLoading && branchTasks.length > 0;
  const showDirtyWarning = deleteWorktree && dirtyTasks.length > 0;

  const handleWorktreeChange = (checked: boolean) => {
    setDeleteWorktree(checked);
    setNeedsDirtyConfirm(false);
    if (!checked) setDeleteBranch(false);
  };

  const handleConfirm = async () => {
    if (isResolvingDelete) return;

    if (!deleteWorktree || dirtyTasks.length > 0 || preflight !== null) {
      onSuccess({ deleteWorktree, deleteBranch });
      return;
    }

    setIsResolvingDelete(true);
    const items = await (preflightPromiseRef.current ?? Promise.resolve([]));
    setIsResolvingDelete(false);
    setPreflight(items);

    if (dirtyTasksFor(items).length > 0) {
      setNeedsDirtyConfirm(true);
      return;
    }

    onSuccess({ deleteWorktree, deleteBranch });
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
      return `"${dirtyTasks[0]?.taskName ?? tasks[0]!.taskName}" has uncommitted changes that will be lost.`;
    }
    const names = dirtyTasks.map((t) => `"${t.taskName}"`).join(', ');
    return `${dirtyTasks.length} ${dirtyTasks.length === 1 ? 'task has' : 'tasks have'} uncommitted changes that will be lost: ${names}`;
  })();

  const dirtyWarningNode = showDirtyWarning && dirtyWarning && (
    <motion.div
      key="dirty-warning"
      initial={{ height: 0, opacity: 0, y: -4 }}
      animate={{ height: 'auto', opacity: 1, y: 0 }}
      exit={{ height: 0, opacity: 0, y: -4 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="flex items-start gap-1.5 rounded-md bg-background-warning px-3 py-2 text-xs text-foreground-warning">
        <TriangleAlert className="mt-px size-3.5 shrink-0" />
        <span>{dirtyWarning}</span>
      </div>
    </motion.div>
  );

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="flex flex-col gap-4 pt-0">
        <p className="text-sm text-foreground-muted">{description}</p>

        <div className="flex flex-col gap-3" aria-live="polite">
          <label
            className="flex items-center gap-2 text-sm aria-disabled:cursor-default aria-disabled:text-foreground-muted"
            aria-disabled={isLoading || !showWorktreeCheckbox}
          >
            <Checkbox
              checked={isLoading ? deleteWorktree : showWorktreeCheckbox && deleteWorktree}
              onCheckedChange={(checked) => handleWorktreeChange(Boolean(checked))}
              disabled={isLoading || !showWorktreeCheckbox}
            />
            {isLoading ? (isBulk ? 'Delete worktrees' : 'Delete worktree') : worktreeLabel}
          </label>

          <AnimatePresence initial={false}>{dirtyWarningNode}</AnimatePresence>

          <label
            className="flex items-center gap-2 text-sm aria-disabled:cursor-default aria-disabled:text-foreground-muted"
            aria-disabled={isLoading || !showBranchCheckbox || !deleteWorktree}
          >
            <Checkbox
              checked={!isLoading && showBranchCheckbox && deleteBranch}
              onCheckedChange={(checked) => setDeleteBranch(Boolean(checked))}
              disabled={isLoading || !showBranchCheckbox || !deleteWorktree}
            />
            {isLoading ? (isBulk ? 'Delete branches' : 'Delete branch') : branchLabel}
          </label>
        </div>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton
          variant="destructive"
          disabled={isResolvingDelete}
          onClick={() => void handleConfirm()}
        >
          {isResolvingDelete
            ? 'Verifying…'
            : needsDirtyConfirm && showDirtyWarning
              ? 'Delete anyway'
              : isBulk
                ? `Delete ${count} tasks`
                : 'Delete'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

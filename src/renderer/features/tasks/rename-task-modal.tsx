import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { isRegistered } from '@renderer/features/tasks/stores/task-store';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import {
  liveTransformTaskName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskName,
  taskNameCollisionKey,
} from '@renderer/utils/taskNames';
import type { RenameTaskError } from '@shared/tasks';

type RenameTaskModalArgs = {
  projectId: string;
  taskId: string;
  currentName: string;
};

type Props = BaseModalProps<void> & RenameTaskModalArgs;

function formatRenameTaskError(error: RenameTaskError): string {
  switch (error.type) {
    case 'task-not-found':
      return 'Task not found.';
    case 'project-not-found':
      return 'Project not found.';
    case 'branch-managed-by-linked-issue':
      return 'Branch name is managed by the linked issue.';
    case 'branch-has-open-pr':
      return `Branch "${error.branch}" has an open pull request. Rename the task without renaming the branch.`;
    case 'branch-has-siblings':
      return `Branch "${error.branch}" is used by another task. Rename the task without renaming the branch.`;
    case 'branch-already-exists':
      return `Branch "${error.branch}" already exists. Try a different task name.`;
    case 'branch-rename-failed':
      return `Could not rename branch "${error.branch}": ${error.message}`;
  }
}

export const RenameTaskModal = observer(function RenameTaskModal({
  projectId,
  taskId,
  currentName,
  onSuccess,
  onClose,
}: Props) {
  const [name, setName] = useState(currentName);
  const [renameBranch, setRenameBranch] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { preserveNameCapitalization } = useTaskSettings();

  const taskManager = getTaskManagerStore(projectId);
  const siblingNames = new Set(
    Array.from(taskManager?.tasks.values() ?? [])
      .filter((t) => t.state !== 'unregistered' && t.data.id !== taskId)
      .map((t) => taskNameCollisionKey(t.data.name))
  );

  const normalizedName = normalizeTaskName(name, {
    preserveCapitalization: preserveNameCapitalization,
  });
  const isDuplicate = siblingNames.has(taskNameCollisionKey(normalizedName));
  const isUnchanged = normalizedName === currentName;
  const isEmpty = normalizedName.length === 0;
  const isValid = !isEmpty && !isDuplicate && !isUnchanged;
  const task = taskManager?.tasks.get(taskId);
  const taskPayload = task && isRegistered(task) ? task.data : undefined;
  const taskBranch = taskPayload?.taskBranch;
  const branchHasSiblings = Boolean(
    taskBranch &&
    Array.from(taskManager?.tasks.values() ?? []).some(
      (candidate) =>
        isRegistered(candidate) &&
        candidate.data.id !== taskId &&
        candidate.data.taskBranch === taskBranch
    )
  );
  const hasOpenPullRequest = taskPayload?.prs.some((pr) => pr.status === 'open') ?? false;
  const branchManagedByLinkedIssue = taskPayload?.linkedIssue?.provider === 'linear';
  const canRenameLocalBranch = Boolean(
    taskBranch &&
    taskPayload?.sourceBranch &&
    taskBranch !== taskPayload.sourceBranch.branch &&
    !hasOpenPullRequest &&
    !branchHasSiblings &&
    !branchManagedByLinkedIssue
  );
  const branchRenameDisabledReason = (() => {
    if (
      !taskBranch ||
      !taskPayload?.sourceBranch ||
      taskBranch === taskPayload.sourceBranch.branch
    ) {
      return 'This task has no separate branch to rename';
    }
    if (branchManagedByLinkedIssue) return 'Linear manages this branch name';
    if (hasOpenPullRequest) return 'Open pull requests must keep their current branch';
    if (branchHasSiblings) return 'Another task uses this branch';
    return null;
  })();

  const validationMessage = isDuplicate
    ? 'A task with this name already exists in this project.'
    : isEmpty
      ? 'Task name cannot be empty.'
      : undefined;

  const handleNameChange = useCallback(
    (value: string) => {
      setName(
        liveTransformTaskName(value, {
          preserveCapitalization: preserveNameCapitalization,
        })
      );
      setError(null);
    },
    [preserveNameCapitalization]
  );

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    const task = taskManager?.tasks.get(taskId);
    if (!task) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await task.rename(normalizedName, {
        renameBranch: renameBranch && canRenameLocalBranch,
      });
      if (!result.success) {
        setError(formatRenameTaskError(result.error));
        setIsSubmitting(false);
        return;
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename task');
      setIsSubmitting(false);
    }
  }, [isValid, taskManager, taskId, normalizedName, renameBranch, canRenameLocalBranch, onSuccess]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>Rename task</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>Task name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              maxLength={MAX_TASK_NAME_LENGTH}
              autoFocus
            />
            {validationMessage && !isUnchanged && (
              <p className="text-destructive mt-1 text-xs">{validationMessage}</p>
            )}
            {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
          </Field>
          <Tooltip>
            <TooltipTrigger>
              <label
                className="flex cursor-pointer items-center gap-2 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                aria-disabled={!canRenameLocalBranch}
              >
                <Checkbox
                  checked={renameBranch}
                  onCheckedChange={(checked) => setRenameBranch(Boolean(checked))}
                  disabled={!canRenameLocalBranch}
                />
                Rename local branch
              </label>
            </TooltipTrigger>
            {branchRenameDisabledReason ? (
              <TooltipContent>{branchRenameDisabledReason}</TooltipContent>
            ) : null}
          </Tooltip>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {isSubmitting ? 'Renaming...' : 'Rename'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});

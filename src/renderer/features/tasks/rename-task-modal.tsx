import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { RenameTaskError } from '@shared/tasks';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import {
  liveTransformTaskName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskName,
} from '@renderer/utils/taskNames';

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskManager = getTaskManagerStore(projectId);
  const siblingNames = new Set(
    Array.from(taskManager?.tasks.values() ?? [])
      .filter((t) => t.state !== 'unregistered' && t.data.id !== taskId)
      .map((t) => t.data.name)
  );

  const normalizedName = normalizeTaskName(name);
  const isDuplicate = siblingNames.has(normalizedName);
  const isUnchanged = normalizedName === currentName;
  const isEmpty = normalizedName.length === 0;
  const isValid = !isEmpty && !isDuplicate && !isUnchanged;

  const validationMessage = isDuplicate
    ? 'A task with this name already exists in this project.'
    : isEmpty
      ? 'Task name cannot be empty.'
      : undefined;

  const handleNameChange = useCallback((value: string) => {
    setName(liveTransformTaskName(value));
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    const task = taskManager?.tasks.get(taskId);
    if (!task) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await task.rename(normalizedName);
      if (!result.success) {
        setError(formatRenameTaskError(result.error));
        setIsSubmitting(false);
        return;
      }
      if (result.data.warning) {
        toast.error(
          `Branch was renamed locally to "${result.data.warning.branch}", but could not be pushed to the remote: ${result.data.warning.message}`
        );
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename task');
      setIsSubmitting(false);
    }
  }, [isValid, taskManager, taskId, normalizedName, onSuccess]);

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
              <p className="text-xs text-destructive mt-1">{validationMessage}</p>
            )}
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </Field>
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

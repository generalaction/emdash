import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { getTaskManagerStore } from '@renderer/core/stores/task-selectors';
import {
  liveTransformTaskName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskName,
} from '@renderer/lib/taskNames';

type RenameTaskModalArgs = {
  projectId: string;
  taskId: string;
  currentName: string;
};

type Props = BaseModalProps<void> & RenameTaskModalArgs;

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
      await task.rename(normalizedName);
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

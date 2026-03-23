import { useCallback, useMemo, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useTasksDataContext } from '@renderer/core/tasks/tasks-data-provider';
import {
  liveTransformTaskName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskName,
} from '@renderer/lib/taskNames';

export type RenameTaskModalArgs = {
  projectId: string;
  taskId: string;
  currentName: string;
};

type Props = BaseModalProps<void> & RenameTaskModalArgs;

export function RenameTaskModal({ projectId, taskId, currentName, onSuccess, onClose }: Props) {
  const { tasks, renameTask } = useTasksDataContext();
  const [name, setName] = useState(currentName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siblingNames = useMemo(
    () =>
      new Set(tasks.filter((t) => t.projectId === projectId && t.id !== taskId).map((t) => t.name)),
    [tasks, projectId, taskId]
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
    setIsSubmitting(true);
    setError(null);
    try {
      await renameTask(projectId, taskId, normalizedName);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename task');
      setIsSubmitting(false);
    }
  }, [isValid, renameTask, projectId, taskId, normalizedName, onSuccess]);

  return (
    <DialogContent showCloseButton={false} className="sm:max-w-xs">
      <DialogHeader>
        <DialogTitle>Rename task</DialogTitle>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel>Task name</FieldLabel>
          <Input
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
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
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
          {isSubmitting ? 'Renaming...' : 'Rename'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

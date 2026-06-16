import { EditableNameField } from '@renderer/lib/ui/editable-name-field';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { type TaskNameState } from './use-task-name';

interface TaskNameFieldProps {
  state: TaskNameState;
}

export function TaskNameField({ state }: TaskNameFieldProps) {
  const { taskName, placeholder, handleTaskNameChange, showSlugHint } = state;

  return (
    <Field className="flex flex-col gap-1">
      <FieldLabel>Task name</FieldLabel>
      <EditableNameField
        autoFocus
        value={taskName}
        placeholder={placeholder || 'Task name...'}
        onChange={handleTaskNameChange}
      />
      {showSlugHint && (
        <p className="text-muted-foreground mt-1 text-xs">
          Task names only allow letters, numbers, and hyphens.
        </p>
      )}
    </Field>
  );
}

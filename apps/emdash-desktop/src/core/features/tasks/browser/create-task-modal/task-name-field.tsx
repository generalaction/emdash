import { type TaskNameState } from '@core/features/tasks/api/browser/create-task-modal/use-task-name';
import { EditableNameField } from '@core/primitives/ui/browser/editable-name-field';
import { Field, FieldLabel } from '@core/primitives/ui/browser/field';

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

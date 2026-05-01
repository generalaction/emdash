import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { type TaskNameState } from './use-task-name';

interface TaskNameFieldProps {
  state: TaskNameState;
}

export function TaskNameField({ state }: TaskNameFieldProps) {
  const { taskName, handleTaskNameChange, showSlugHint } = state;

  return (
    <Field>
      <FieldLabel>Task name</FieldLabel>
      <Input value={taskName} onChange={(e) => handleTaskNameChange(e.target.value)} />
      {showSlugHint && (
        <p className="text-xs text-muted-foreground mt-1">
          Task names only allow lowercase letters, numbers, and hyphens.
        </p>
      )}
    </Field>
  );
}

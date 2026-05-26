import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { type TaskNameState } from './use-task-name';

interface TaskNameFieldProps {
  state: TaskNameState;
}

export function TaskNameField({ state }: TaskNameFieldProps) {
  const { taskName, placeholder, handleTaskNameChange, showSlugHint } = state;

  return (
    <Field className="flex flex-col gap-1">
      <FieldLabel>Task name</FieldLabel>
      <Input
        data-autofocus
        value={taskName}
        placeholder={placeholder || 'Task name...'}
        className="border-none px-0 text-lg! focus-visible:ring-0"
        onChange={(e) => handleTaskNameChange(e.target.value)}
      />
      {showSlugHint && (
        <p className="text-muted-foreground mt-1 text-xs">
          Task names only allow letters, numbers, and hyphens.
        </p>
      )}
    </Field>
  );
}

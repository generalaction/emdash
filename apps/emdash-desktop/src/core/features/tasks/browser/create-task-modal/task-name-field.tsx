import { Field, Input } from '@emdash/ui/react/primitives';
import { type TaskNameState } from '@core/features/tasks/api/browser/create-task-modal/use-task-name';

interface TaskNameFieldProps {
  state: TaskNameState;
}

export function TaskNameField({ state }: TaskNameFieldProps) {
  const { taskName, placeholder, handleTaskNameChange, showSlugHint } = state;

  return (
    <Field.Root className="flex flex-col gap-1">
      <Field.Label>Task name</Field.Label>
      <Input
        bare
        autoFocus
        value={taskName}
        placeholder={placeholder || 'Task name...'}
        className="px-0 text-lg!"
        onChange={(e) => handleTaskNameChange(e.target.value)}
      />
      {showSlugHint && (
        <p className="text-muted-foreground mt-1 text-xs">
          Task names only allow letters, numbers, and hyphens.
        </p>
      )}
    </Field.Root>
  );
}

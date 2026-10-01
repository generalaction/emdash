import { Field, Input } from '@emdash/ui/react/primitives';
import { type TaskNameState } from '@core/features/tasks/api/browser/create-task-modal/use-task-name';

interface TaskNameFieldProps {
  state: TaskNameState;
  autoNameWithAgent?: boolean;
}

export function TaskNameField({ state, autoNameWithAgent = false }: TaskNameFieldProps) {
  const { taskName, placeholder, handleTaskNameChange, showSlugHint } = state;

  return (
    <Field.Root className="flex flex-col gap-1">
      <Input
        aria-label="Task name"
        bare
        autoFocus
        value={taskName}
        placeholder={placeholder || 'Task name...'}
        className="px-0 text-lg!"
        onChange={(e) => handleTaskNameChange(e.target.value)}
      />
      {autoNameWithAgent && (
        <Field.Description>
          Your first conversation’s AI will replace this placeholder with a short name of up to five
          words. If unsupported, the original name stays.
        </Field.Description>
      )}
      {showSlugHint && (
        <p className="text-muted-foreground mt-1 text-xs">
          Task names only allow letters, numbers, and hyphens.
        </p>
      )}
    </Field.Root>
  );
}

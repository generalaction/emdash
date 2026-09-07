import { AgentStatus as AgentStatusUi } from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import { type TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { TaskGitDiffStats } from '@core/features/tasks/contributions/browser/task-git-diff-stats';
import type { AgentStatus } from '@core/primitives/agents/api';
import { cn } from '@core/primitives/styling/browser/cn';

export interface TaskDataLineProps {
  task: TaskStore;
  agentStatus: AgentStatus | null;
  missedDeadline: boolean;
}

export const TaskDataLine = observer(function TaskDataLine({
  task,
  agentStatus,
  missedDeadline,
}: TaskDataLineProps) {
  return (
    <div className="flex h-6 min-w-0 items-center justify-between gap-2 pr-1">
      <div className="flex items-center gap-1">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm text-foreground',
            missedDeadline && 'text-destructive'
          )}
        >
          {task.displayName}
        </span>
        <AgentStatusUi status={agentStatus} tooltip />
      </div>
      <TaskGitDiffStats task={task} />
    </div>
  );
});

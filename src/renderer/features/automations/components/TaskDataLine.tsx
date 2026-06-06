import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { TaskGitDiffStats } from '@renderer/features/tasks/components/task-git-diff-stats';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
import { type TaskStore } from '@renderer/features/tasks/stores/task-store';
import { cn } from '@renderer/utils/utils';

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
        <AgentStatusIndicator status={agentStatus} />
      </div>
      <TaskGitDiffStats task={task} />
    </div>
  );
});

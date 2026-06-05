import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { TaskGitDiffStats } from '@renderer/features/tasks/components/task-git-diff-stats';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
import { isRegistered, type TaskStore } from '@renderer/features/tasks/stores/task-store';
import { cn } from '@renderer/utils/utils';

export interface TaskDataLineProps {
  task: TaskStore;
  agentStatus: AgentStatus | null;
  isRunActive: boolean;
  missedDeadline: boolean;
}

export const TaskDataLine = observer(function TaskDataLine({
  task,
  agentStatus,
  isRunActive,
  missedDeadline,
}: TaskDataLineProps) {
  const registeredData = isRegistered(task) ? task.data : undefined;
  const providerEntries = registeredData ? Object.entries(registeredData.conversations) : [];

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm font-medium text-foreground',
          isRunActive && 'text-shimmer',
          missedDeadline && 'text-destructive'
        )}
      >
        {task.displayName}
      </span>
      <AgentStatusIndicator status={agentStatus} disableTooltip />
      <TaskGitDiffStats task={task} />
      {providerEntries.map(([provider, count]) => (
        <span key={provider} className="shrink-0 text-xs text-foreground-passive">
          {provider}
          {count > 1 ? ` ×${count}` : ''}
        </span>
      ))}
    </div>
  );
});

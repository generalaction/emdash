import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/components/agent-status-indicator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { isUnprovisioned, isUnregistered, type TaskStore } from '@renderer/core/stores/task';
import { taskAgentStatus } from '@renderer/core/stores/task-selectors';
import { CLISpinner } from '@renderer/core/tasks/components/cliSpinner';
import { useDelayedBoolean } from '@renderer/hooks/use-delay-boolean';
import { RelativeTime } from '../../components/ui/relative-time';

/**
 * Sidebar tail: spinner while bootstrapping, otherwise aggregate agent status indicator.
 */
export const TaskSidebarAgentStatus = observer(function TaskSidebarAgentStatus({
  task,
}: {
  task: TaskStore;
}) {
  const isBootstrapping =
    isUnregistered(task) ||
    (isUnprovisioned(task) && (task.phase === 'provision' || task.phase === 'provision-error'));

  const delayedIsBootstrapping = useDelayedBoolean(isBootstrapping, 500);
  const status = taskAgentStatus(task);

  if (delayedIsBootstrapping) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="size-6 flex justify-center items-center">
            <CLISpinner variant="2" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Creating task workspace...</TooltipContent>
      </Tooltip>
    );
  }

  if (status) {
    return <AgentStatusIndicator status={status} />;
  }

  return (
    <RelativeTime
      value={task.data.createdAt}
      className="text-xs text-foreground-passive font-mono pr-1 h-full flex items-center"
      compact
    />
  );
});

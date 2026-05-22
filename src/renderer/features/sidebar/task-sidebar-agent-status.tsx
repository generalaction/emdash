import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { CLISpinner } from '@renderer/features/tasks/components/cliSpinner';
import { taskAgentStatus } from '@renderer/features/tasks/stores/task-selectors';
import {
  isUnprovisioned,
  isUnregistered,
  type TaskStore,
} from '@renderer/features/tasks/stores/task-store';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

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
          <span className="flex size-6 items-center justify-center">
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

  return null;
});

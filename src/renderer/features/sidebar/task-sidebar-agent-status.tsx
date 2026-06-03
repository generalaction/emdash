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
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { getSortInstant, sortKindFor } from './sidebar-store';

/**
 * Sidebar trailing slot: spinner while bootstrapping, the live agent status
 * indicator while an agent is active (non-idle), otherwise the relative
 * timestamp. The whole metadata cluster is right-aligned by the parent, so
 * the slot just hugs its content — no fixed width to avoid an empty gap
 * between the timestamp and the line-changes / PR icon to its left.
 */
function Slot({ children }: { children: React.ReactNode }) {
  return <span className="flex w-[3ch] shrink-0 items-center justify-end">{children}</span>;
}

export const TaskSidebarTrailingSlot = observer(function TaskSidebarTrailingSlot({
  task,
  showTimestamp,
}: {
  task: TaskStore;
  showTimestamp: boolean;
}) {
  const isBootstrapping =
    isUnregistered(task) ||
    (isUnprovisioned(task) && (task.phase === 'provision' || task.phase === 'provision-error'));
  const delayedIsBootstrapping = useDelayedBoolean(isBootstrapping, 500);

  if (delayedIsBootstrapping) {
    return (
      <Slot>
        <Tooltip>
          <TooltipTrigger>
            <span className="flex size-6 items-center justify-center">
              <CLISpinner variant="2" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Creating task workspace...</TooltipContent>
        </Tooltip>
      </Slot>
    );
  }

  // 'completed' and null (idle) are terminal states; show the timestamp for those.
  // All other live states ('working', 'awaiting-input', 'error') get the indicator.
  const status = taskAgentStatus(task);
  if (status !== null && status !== 'completed') {
    return (
      <Slot>
        <AgentStatusIndicator status={status} />
      </Slot>
    );
  }

  if (!showTimestamp) return null;

  const instant = getSortInstant(task, sortKindFor(sidebarStore.lastTaskSortBy));
  if (!instant) return null;

  return (
    <Slot>
      <RelativeTime
        value={instant}
        className="font-mono text-xs text-foreground-passive tabular-nums"
        compact
      />
    </Slot>
  );
});

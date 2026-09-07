import { AgentStatus, BrailleSpinner } from '@emdash/ui/react/components';
import { RelativeTime, Tooltip } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import { type TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { useDelayedBoolean } from '@core/primitives/react-hooks/browser/use-delay-boolean';
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
  const delayedIsBootstrapping = useDelayedBoolean(task.isBootstrapping, 500);

  if (delayedIsBootstrapping) {
    return (
      <Slot>
        <Tooltip.Root>
          <Tooltip.Trigger>
            <span className="flex size-6 items-center justify-center">
              <BrailleSpinner variant="wave" />
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content>Creating task workspace...</Tooltip.Content>
        </Tooltip.Root>
      </Slot>
    );
  }

  // Show the agent status indicator for any active/unseen state; fall back to timestamp for null (idle).
  const status = taskAgentStatus(task);
  if (status !== null) {
    return (
      <Slot>
        <AgentStatus status={status} tooltip />
      </Slot>
    );
  }

  if (!showTimestamp) return null;

  const instant = getSortInstant(task, sortKindFor(getSidebarStore().taskSortBy));
  if (!instant) return null;

  return (
    <Slot>
      <RelativeTime
        value={instant}
        className="font-sans text-xs text-foreground-passive tabular-nums"
        compact
      />
    </Slot>
  );
});

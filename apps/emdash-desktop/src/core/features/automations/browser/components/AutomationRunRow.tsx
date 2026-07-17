import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import { useAutomationRunActions } from '@core/features/automations/browser/use-automation-run-actions';
import {
  getRegisteredTaskData,
  getTaskIdForAutomationRun,
  getTaskStore,
  taskAgentStatus,
} from '@core/features/tasks/browser/stores/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { isAutomationRunAdoptable } from '@core/primitives/automations/api';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { useAutomationRun } from '../use-automations';
import { RunMetaLine } from './RunMetaLine';
import { TaskDataLine } from './TaskDataLine';
import { TaskPlaceholder } from './TaskPlaceholder';

interface AutomationRunRowProps {
  runId: string;
  automationId: string;
  projectId: string | null;
  run?: AutomationRun;
}

export const AutomationRunRow = observer(function AutomationRunRow({
  runId,
  automationId,
  projectId,
  run: runProp,
}: AutomationRunRowProps) {
  const { navigate } = useNavigate();
  const fetchedRun = useAutomationRun(automationId, runId);
  const run = runProp ?? fetchedRun;
  const { adoptRun, isAdopting, runtimeAvailable } = useAutomationRunActions(
    automationId,
    projectId
  );

  const taskId = run && projectId ? getTaskIdForAutomationRun(projectId, run.id) : null;
  const taskStore = taskId && projectId ? getTaskStore(projectId, taskId) : undefined;
  const task = taskId && projectId ? getRegisteredTaskData(projectId, taskId) : undefined;
  const interactive = Boolean(
    projectId &&
    ((taskId && !task?.archivedAt) ||
      (!taskId && runtimeAvailable && run && isAutomationRunAdoptable(run) && !isAdopting))
  );
  const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;
  const displayTime = run ? (run.startedAt ?? run.finishedAt) : null;
  const missedDeadline = run?.error?.code === 'deadline_exceeded';
  const displayName = run?.generatedName ?? null;

  async function handleOpenTask() {
    if (!projectId || !interactive) return;
    try {
      const adopted = taskId ? { taskId, projectId } : await adoptRun(runId);
      navigate(taskViewDef(adopted));
    } catch (error) {
      toast.error('Could not open automation run', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!run) return null;

  return (
    <div
      className={cn(
        'group relative flex cursor-pointer flex-col px-2 py-2 transition-colors',
        interactive ? 'hover:bg-background-2' : 'cursor-default opacity-70'
      )}
      role="button"
      tabIndex={interactive ? 0 : -1}
      onClick={interactive ? () => void handleOpenTask() : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              void handleOpenTask();
            }
          : undefined
      }
      aria-label={
        taskStore
          ? `Open ${taskStore.displayName}`
          : displayName
            ? `Open ${displayName}`
            : 'Open run'
      }
      aria-disabled={!interactive}
    >
      {taskStore ? (
        <TaskDataLine task={taskStore} agentStatus={agentStatus} missedDeadline={missedDeadline} />
      ) : (
        <TaskPlaceholder name={displayName} />
      )}
      <RunMetaLine
        displayTime={displayTime}
        triggerKind={run.triggerKind}
        runStatus={run.status}
        error={run.error}
      />
    </div>
  );
});

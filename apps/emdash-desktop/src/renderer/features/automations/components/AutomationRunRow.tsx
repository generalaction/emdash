import { Check, Loader2, Square } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useAutomationRunActions } from '@renderer/features/automations/use-automation-run-actions';
import {
  getRegisteredTaskData,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import type { AutomationRun } from '@shared/core/automations/automation-run';
import { useAutomationRun } from '../use-automations';
import { RunMetaLine } from './RunMetaLine';
import { TaskDataLine } from './TaskDataLine';
import { TaskPlaceholder } from './TaskPlaceholder';

interface AutomationRunRowProps {
  runId: string;
  automationId: string;
  run?: AutomationRun;
}

export const AutomationRunRow = observer(function AutomationRunRow({
  runId,
  automationId,
  run: runProp,
}: AutomationRunRowProps) {
  const { navigate } = useNavigate();
  const fetchedRun = useAutomationRun(automationId, runId);
  const run = runProp ?? fetchedRun;
  const { projectId, canStopRun, stopRun, stopRunPending, stopRunSucceeded } =
    useAutomationRunActions(automationId, run);

  const taskId = run ? run.taskId : null;
  const taskStore = taskId && projectId ? getTaskStore(projectId, taskId) : undefined;
  const task = taskId && projectId ? getRegisteredTaskData(projectId, taskId) : undefined;

  const interactive = Boolean(taskId && task && !task.archivedAt);
  const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;

  const displayTime = run ? (run.startedAt ?? run.finishedAt) : null;
  const missedDeadline = run?.error?.code === 'deadline_exceeded';

  const displayName = run?.generatedTaskName ?? null;

  function handleOpenTask() {
    if (!taskId || !projectId || !interactive) return;
    navigate('task', { projectId, taskId });
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
      onClick={interactive ? handleOpenTask : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              handleOpenTask();
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
        statusAction={
          stopRunPending ? (
            <span className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-foreground-muted">
              <Loader2 className="size-3 animate-spin" />
              Stopping…
            </span>
          ) : stopRunSucceeded ? (
            <span className="flex items-center gap-1 rounded-md bg-background-3 px-1.5 py-0.5 text-xs text-foreground-muted">
              <Check className="size-3" />
              Stopped
            </span>
          ) : canStopRun ? (
            <button
              type="button"
              className="flex shrink-0 appearance-none items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-xs text-foreground-destructive outline-none hover:bg-background-destructive active:bg-background-destructive disabled:pointer-events-none"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void stopRun();
              }}
            >
              <Square className="size-3 fill-current" />
              Stop task run
            </button>
          ) : undefined
        }
      />
    </div>
  );
});

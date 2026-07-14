import { Square } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { isAutomationConversationRunning } from '@renderer/features/automations/automation-run-stop';
import { useAutomationRunActions } from '@renderer/features/automations/use-automation-run-actions';
import {
  getConversationsForTask,
  getRegisteredTaskData,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
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
  const { projectId, stopTaskRun, stopPending } = useAutomationRunActions(automationId);

  const taskId = run ? run.taskId : null;
  const taskStore = taskId && projectId ? getTaskStore(projectId, taskId) : undefined;
  const task = taskId && projectId ? getRegisteredTaskData(projectId, taskId) : undefined;

  const interactive = Boolean(taskId && task && !task.archivedAt);
  const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;
  const conversations = taskId ? getConversationsForTask(taskId)?.conversations.values() : null;
  const canStop = conversations
    ? Array.from(conversations).some(isAutomationConversationRunning)
    : false;

  const displayTime = run ? (run.startedAt ?? run.finishedAt) : null;
  const missedDeadline = run?.error?.code === 'deadline_exceeded';

  const displayName = run?.generatedTaskName ?? null;

  function handleOpenTask() {
    if (!taskId || !projectId || !interactive) return;
    navigate('task', { projectId, taskId });
  }

  function handleStop() {
    if (!run || stopPending) return;
    void stopTaskRun(run);
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
              if (e.target !== e.currentTarget) return;
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
        <TaskDataLine
          task={taskStore}
          agentStatus={agentStatus}
          missedDeadline={missedDeadline}
          hideTrailingOnRowInteraction={canStop}
        />
      ) : (
        <TaskPlaceholder name={displayName} />
      )}
      <RunMetaLine
        displayTime={displayTime}
        triggerKind={run.triggerKind}
        runStatus={run.status}
        error={run.error}
        hideStatusOnRowInteraction={canStop}
      />
      {canStop && (
        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="hover:border-border-destructive hover:bg-background-destructive hover:text-foreground-destructive"
                  aria-label="Stop task run"
                  disabled={stopPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleStop();
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                />
              }
            >
              <Square className="size-3" />
              Stop task
            </TooltipTrigger>
            <TooltipContent>Stop task run</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

import { Square } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { isActiveStatus } from '@renderer/features/automations/run-status-styles';
import { useAutomationRunActions } from '@renderer/features/automations/use-automation-run-actions';
import { conversationRegistry } from '@renderer/features/tasks/stores/conversation-registry';
import {
  getRegisteredTaskData,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { AutomationRun } from '@shared/automations/automation-run';
import { parseRunError } from '@shared/automations/format';
import { makePtySessionId } from '@shared/ptySessionId';
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
  const { stopRun, projectId } = useAutomationRunActions(automationId);

  const taskId = run ? run.taskId : null;
  const taskStore = taskId && projectId ? getTaskStore(projectId, taskId) : undefined;
  const task = taskId && projectId ? getRegisteredTaskData(projectId, taskId) : undefined;

  const interactive = Boolean(taskId && task && !task.archivedAt);
  const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;

  const displayTime = run ? (run.startedAt ?? run.finishedAt) : null;
  const isRunActive = run ? isActiveStatus(run.status) : false;
  const missedDeadline = run ? parseRunError(run.error)?.code === 'deadline_exceeded' : false;

  const displayName = run?.generatedTaskName ?? null;

  function handleOpenTask() {
    if (!taskId || !projectId || !interactive) return;
    navigate('task', { projectId, taskId });
  }

  function handleStop() {
    if (!run) return;
    stopRun(run.id);
    if (run.status === 'creating_conversation' && taskId && projectId) {
      for (const conv of conversationRegistry.get(taskId)?.conversations.values() ?? []) {
        if (conv.status === 'working' || conv.status === 'awaiting-input') {
          void rpc.pty.stopSession(makePtySessionId(projectId, taskId, conv.data.id));
        }
      }
    }
  }

  if (!run) return null;

  return (
    <div
      className={cn(
        'group relative flex cursor-pointer flex-col gap-1 px-3 py-2.5 transition-colors',
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
        <TaskDataLine
          task={taskStore}
          agentStatus={agentStatus}
          isRunActive={isRunActive}
          missedDeadline={missedDeadline}
        />
      ) : (
        <TaskPlaceholder name={displayName} />
      )}
      <RunMetaLine displayTime={displayTime} triggerKind={run.triggerKind} runStatus={run.status} />

      {/* Hover action overlay */}
      {isRunActive && (
        <div
          className="absolute inset-y-0 right-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Stop run"
                  onClick={handleStop}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground"
                />
              }
            >
              <Square className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Stop run</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

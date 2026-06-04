import { Ellipsis, Square, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { automationRunTool } from '@renderer/features/automations/automation-tools';
import {
  useAutomation,
  useAutomationRun,
} from '@renderer/features/automations/automations-context';
import { isActiveStatus } from '@renderer/features/automations/run-status-styles';
import { useAutomationRunActions } from '@renderer/features/automations/use-automation-run-actions';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import {
  getRegisteredTaskData,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { StackedAgentLogos } from '@renderer/lib/components/stacked-agent-logos';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { formatRunTriggerKindLabel, isQueueDeadlineExceededRun } from '@shared/automations/format';
import { useAutomationAgentActivity } from '../automation-run-status-store';

interface AutomationRunRowProps {
  runId: string;
  automationId: string;
}

export const AutomationRunRow = observer(function AutomationRunRow({
  runId,
  automationId,
}: AutomationRunRowProps) {
  const { navigate } = useNavigate();
  const run = useAutomationRun(automationId, runId);
  const automation = useAutomation(automationId);
  const { deleteRun } = useAutomationRunActions();

  const taskId = run ? (run.createdTaskId ?? run.taskId) : null;
  const projectId = automation?.projectId ?? null;
  const agentActivity = useAutomationAgentActivity(taskId);
  const taskStore = taskId && projectId ? getTaskStore(projectId, taskId) : undefined;
  const task = taskId && projectId ? getRegisteredTaskData(projectId, taskId) : undefined;

  const interactive = Boolean(taskId && task && !task.archivedAt);
  const taskAgentActivityStatus = taskStore ? taskAgentStatus(taskStore) : null;
  const agentStatus = taskStore ? taskAgentActivityStatus : (agentActivity?.status ?? null);

  const tool = useMemo(() => (run ? automationRunTool(run, automation) : null), [automation, run]);

  const agentLogoStats = useMemo(() => {
    if (!tool || !run) return {};
    const providerId =
      run.agentProviderId ?? automation?.taskConfig?.taskConfig.initialConversation?.provider;
    if (!providerId) return {};
    return { [providerId]: 1 };
  }, [tool, run, automation]);

  const displayTime = run ? (run.startedAt ?? run.scheduledAt ?? run.finishedAt) : null;
  const triggerLabel = run ? formatRunTriggerKindLabel(run.triggerKind) : null;
  const isRunActive = run ? isActiveStatus(run.status) : false;
  const missedDeadline = run ? isQueueDeadlineExceededRun(run) : false;

  const displayName = task?.name ?? null;

  function handleOpenTask() {
    if (!taskId || !projectId || !interactive) return;
    navigate('task', { projectId, taskId });
  }

  function handleStop() {
    if (!taskId || !projectId) return;
    navigate('task', { projectId, taskId });
  }

  if (!run) return null;

  return (
    <div
      className={cn(
        'group relative flex cursor-pointer flex-col gap-1 rounded-lg px-3 py-2.5 transition-colors',
        interactive ? 'hover:bg-background-1' : 'cursor-default opacity-70'
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
      aria-label={displayName ? `Open ${displayName}` : 'Open run'}
      aria-disabled={!interactive}
    >
      {/* Line 1: task name + agent status | agent logos */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex flex-row items-center gap-1">
          {displayName && (
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm font-medium text-foreground',
                isRunActive && 'text-shimmer',
                missedDeadline && 'text-destructive'
              )}
            >
              {displayName}
            </span>
          )}
          <AgentStatusIndicator status={agentStatus} disableTooltip />
        </div>
        <StackedAgentLogos stats={agentLogoStats} />
      </div>

      {/* Line 2: date | triggered by */}
      <div className="flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
        <span className="flex-1">
          {displayTime ? <AbsoluteTime value={displayTime} /> : <span>—</span>}
        </span>
        {triggerLabel && <span className="shrink-0">Triggered by {triggerLabel}</span>}
      </div>

      {/* Hover action overlay */}
      <div
        className="absolute inset-y-0 right-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {isRunActive && (
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
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="More options"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground"
              />
            }
          >
            <Ellipsis className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            <DropdownMenuItem
              variant="destructive"
              disabled={!deleteRun}
              onClick={() => deleteRun?.(run)}
            >
              <Trash2 />
              Delete run
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

import { Bot, Clock, Folder, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { automationTool } from '@renderer/features/automations/automation-tools';
import {
  isActiveStatus,
  statusIndicatorConfig,
} from '@renderer/features/automations/run-status-styles';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { getRegisteredTaskData, getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { Badge } from '@renderer/lib/ui/badge';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  formatRunError,
  formatRunName,
  formatRunTriggerKindLabel,
  isQueueDeadlineExceededRun,
} from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';

const automationListRowClassName =
  'group flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:outline-none';

type AutomationRunRowVariant = 'row' | 'card';

interface AutomationRunRowProps {
  run: AutomationRun;
  automation?: Automation;
  projectId: string | null;
  title: string;
  showProjectName?: boolean;
  variant?: AutomationRunRowVariant;
  onDelete?: (run: AutomationRun) => void;
  onRerun?: (run: AutomationRun) => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

export const AutomationRunRow = observer(function AutomationRunRow({
  run,
  automation,
  projectId,
  title,
  showProjectName = false,
  variant = 'row',
  onDelete,
  onRerun,
  isSelected,
  onToggleSelect,
}: AutomationRunRowProps) {
  const { navigate } = useNavigate();
  const taskId = run.taskId;
  const task = taskId && projectId ? getRegisteredTaskData(projectId, taskId) : undefined;
  const interactive = Boolean(taskId && task && !task.archivedAt);
  const hadAgent = Boolean(run.createdTaskId);
  const tooltip = interactive
    ? 'Open agent'
    : hadAgent
      ? 'Agent was deleted'
      : 'This run did not create an agent';

  const tool = useMemo(() => automationTool(automation), [automation]);
  const isFailed = run.status === 'failed';
  const isActive = isActiveStatus(run.status);
  const missedDeadline = isQueueDeadlineExceededRun(run);
  const errorMessage = run.error ? formatRunError(run.error) : undefined;
  const status = statusIndicatorConfig(run.status);
  const StatusIcon = status.Icon;
  const projectName = showProjectName
    ? projectId
      ? projectDisplayName(getProjectStore(projectId))
      : 'No project'
    : undefined;

  const runName = formatRunName(run.id);
  const automationLabel = title;
  const promptSubtitle = errorMessage ? undefined : title;
  const subtitleParts = [errorMessage, promptSubtitle].filter((part): part is string =>
    Boolean(part)
  );
  const subtitle = subtitleParts[0];

  const metaParts = [projectName, formatRunTriggerKindLabel(run.triggerKind)].filter(
    (part): part is string => Boolean(part)
  );
  const displayTime = run.startedAt ?? run.scheduledAt ?? run.finishedAt;
  const triggerLabel = formatRunTriggerKindLabel(run.triggerKind);
  const isListLayout = variant === 'card';

  function handleOpenTask() {
    if (!taskId || !projectId || !interactive) return;
    const taskView = getTaskView(projectId, taskId);
    taskView?.activateLastTabOfKind('conversation');
    navigate('task', { projectId, taskId });
  }

  const selectable = Boolean(onToggleSelect);

  const agentIconWithStatusDot = (
    <>
      {tool ? (
        <AgentLogo
          logo={tool.logo}
          alt={tool.label}
          isSvg={tool.isSvg}
          invertInDark={tool.invertInDark}
          className="size-5 rounded-sm"
        />
      ) : (
        <Bot className="size-5" />
      )}
      <span
        aria-hidden
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background',
          status.dotClass,
          status.spin && 'animate-pulse'
        )}
      />
    </>
  );

  const listIconSlot = selectable ? (
    <div className="relative flex size-9 shrink-0 items-center justify-center">
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border border-border bg-background-1 text-foreground shadow-sm transition-opacity duration-150 ease-out',
          isSelected ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
        )}
      >
        {agentIconWithStatusDot}
      </span>
      <div
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          'relative transition-opacity duration-150 ease-out',
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
        )}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect?.()}
          aria-label="Select run"
        />
      </div>
    </div>
  ) : (
    <Tooltip>
      <TooltipTrigger>
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background-1 text-foreground shadow-sm">
          {agentIconWithStatusDot}
        </span>
      </TooltipTrigger>
      <TooltipContent>{status.label}</TooltipContent>
    </Tooltip>
  );

  const historyIconSlot = selectable ? (
    <div className="relative flex size-9 shrink-0 items-center justify-center">
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border border-border bg-background-1 text-foreground shadow-sm transition-opacity duration-150 ease-out',
          isSelected ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
        )}
      >
        {agentIconWithStatusDot}
      </span>
      <div
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          'relative transition-opacity duration-150 ease-out',
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
        )}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect?.()}
          aria-label="Select run"
        />
      </div>
    </div>
  ) : (
    <Tooltip>
      <TooltipTrigger>
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background-1 text-foreground shadow-sm">
          {agentIconWithStatusDot}
        </span>
      </TooltipTrigger>
      <TooltipContent>{status.label}</TooltipContent>
    </Tooltip>
  );

  const rowContent = (
    <div
      role="button"
      tabIndex={interactive ? 0 : -1}
      onClick={interactive ? handleOpenTask : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              handleOpenTask();
            }
          : undefined
      }
      aria-label={`Open run ${runName}`}
      aria-disabled={!interactive}
      className={cn(
        automationListRowClassName,
        interactive ? 'cursor-pointer hover:bg-background-1' : 'cursor-default opacity-70'
      )}
    >
      {isListLayout ? listIconSlot : historyIconSlot}

      {isListLayout ? (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'block min-w-0 max-w-full truncate text-left text-sm font-medium text-foreground',
                  isActive && 'text-shimmer'
                )}
              >
                {automationLabel}
              </span>
              {missedDeadline ? <Badge variant="destructive">Missed deadline</Badge> : null}
            </div>

            <div className="text-muted-foreground flex min-w-0 items-center gap-3 text-xs">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="truncate">{runName}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <Clock className="size-3 shrink-0" />
                <span className="truncate">{triggerLabel}</span>
              </span>
            </div>

            {errorMessage ? (
              <p className="text-destructive line-clamp-2 text-xs">{errorMessage}</p>
            ) : null}
          </div>

          <div className="flex max-w-[42%] shrink-0 flex-col items-end gap-0.5 text-right">
            {displayTime == null ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <AbsoluteTime value={displayTime} className="text-xs text-muted-foreground" />
            )}
            {projectName ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Folder className="size-3 shrink-0" />
                <span className="truncate">{projectName}</span>
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'block min-w-0 max-w-full truncate text-left text-sm font-medium',
                  isFailed ? 'text-destructive' : 'text-foreground',
                  isActive && !isFailed && 'text-shimmer'
                )}
              >
                {runName}
              </span>
              {missedDeadline ? <Badge variant="destructive">Missed deadline</Badge> : null}
            </div>
            {subtitle ? (
              <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                <span className="truncate">{subtitle}</span>
              </div>
            ) : null}
          </div>

          <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
            <span className={cn('inline-flex items-center gap-1', status.textClass)}>
              <StatusIcon className={cn('size-3 shrink-0', status.spin && 'animate-spin')} />
              <span>{status.label}</span>
            </span>
            {metaParts.length > 0 ? <span className="text-muted-foreground/40">·</span> : null}
            {metaParts.map((part, index) => (
              <span key={`${part}-${index}`} className="flex items-center gap-1">
                {index > 0 ? <span className="text-muted-foreground/40">·</span> : null}
                <span className="truncate">{part}</span>
              </span>
            ))}
            <span className="text-muted-foreground/40">·</span>
            {displayTime == null ? <span>—</span> : <AbsoluteTime value={displayTime} />}
          </div>
        </>
      )}
    </div>
  );

  const wrapped = (
    <Tooltip>
      <TooltipTrigger render={<div />}>{rowContent}</TooltipTrigger>
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
  );

  if (!onDelete && !onRerun) return wrapped;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">{wrapped}</ContextMenuTrigger>
      <ContextMenuContent>
        {onRerun ? (
          <ContextMenuItem onClick={() => onRerun(run)}>
            <RotateCcw />
            Rerun automation
          </ContextMenuItem>
        ) : null}
        {onDelete ? (
          <ContextMenuItem variant="destructive" onClick={() => onDelete(run)}>
            <Trash2 />
            Delete run
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});

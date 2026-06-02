import {
  Bot,
  CirclePause,
  CirclePlay,
  Clock,
  Copy,
  Folder,
  Loader2,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { getTaskStore, taskAgentStatus } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { formatTriggerLabel } from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { useAutomationAgentActivity, useAutomationRunStatus } from '../automation-run-status-store';
import { automationTool } from '../automation-tools';
import { isActiveStatus } from '../run-status-styles';

interface AutomationRowProps {
  automation: Automation;
  recentRuns?: AutomationRun[];
  onEdit: (automation: Automation) => void;
  onRunNow?: (automation: Automation) => void;
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
  onCopy?: (automation: Automation) => void;
  onDelete?: (automation: Automation) => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

export const AutomationRow = observer(function AutomationRow({
  automation,
  recentRuns,
  onEdit,
  onRunNow,
  onToggleEnabled,
  onCopy,
  onDelete,
  isSelected,
  onToggleSelect,
}: AutomationRowProps) {
  const primaryTool = useMemo(() => automationTool(automation), [automation]);
  const runStatus = useAutomationRunStatus(automation.id);

  const isDetached = automation.projectId == null;
  const projectName = automation.projectId
    ? projectDisplayName(getProjectStore(automation.projectId))
    : null;

  const titleRef = useRef<HTMLDivElement>(null);
  const [isTitleTruncated, setIsTitleTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const check = () => setIsTitleTruncated(el.scrollWidth > el.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [automation.name]);

  const dimmed = automation.isDraft || !automation.enabled;
  const tooltipLabel = primaryTool?.label ?? 'Automation';

  const latestRun = recentRuns && recentRuns.length > 0 ? recentRuns[0] : null;
  const latestRunTaskId = latestRun?.createdTaskId ?? latestRun?.taskId ?? null;
  const agentActivity = useAutomationAgentActivity(latestRunTaskId);
  const taskStore =
    latestRunTaskId && automation.projectId
      ? getTaskStore(automation.projectId, latestRunTaskId)
      : null;
  const taskAgentActivity = taskStore ? taskAgentStatus(taskStore) : null;
  const agentStatus = taskStore ? taskAgentActivity : (agentActivity?.status ?? null);
  const latestRunAt =
    latestRun?.startedAt ?? latestRun?.scheduledAt ?? latestRun?.finishedAt ?? null;
  const triggerLabel = formatTriggerLabel(automation.trigger);

  const agentIsWorking = latestRun?.status === 'success' && agentStatus === 'working';
  const isActiveRun = (runStatus ? isActiveStatus(runStatus.status) : false) || agentIsWorking;
  const isRunning = runStatus?.status === 'running' || agentIsWorking;

  const hasContextMenu = Boolean(onRunNow || onToggleEnabled || onCopy || onDelete);
  const canRunNow = !automation.isDraft && !isDetached;
  const canToggle = !automation.isDraft && !isDetached;
  const canCopy = !isDetached;
  const selectable = Boolean(onToggleSelect);

  const selectionSlot = selectable ? (
    <div
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'transition-opacity duration-150 ease-out',
        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
      )}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggleSelect?.()}
        aria-label={`Select ${automation.name}`}
      />
    </div>
  ) : null;

  const toolIcon = (
    <Tooltip>
      <TooltipTrigger>
        <span className="relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-background-2 text-foreground ring-2 ring-background">
          {primaryTool ? (
            <AgentLogo
              logo={primaryTool.logo}
              alt={primaryTool.label}
              isSvg={primaryTool.isSvg}
              invertInDark={primaryTool.invertInDark}
              className="size-3.5 rounded-[2px]"
            />
          ) : (
            <Bot className="size-3.5" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipLabel}</TooltipContent>
    </Tooltip>
  );

  const row = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(automation)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onEdit(automation);
      }}
      aria-label={`Edit ${automation.name}`}
      className={cn(
        'group flex min-h-14 cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-background-1 focus:outline-none focus-visible:outline-none',
        dimmed && 'opacity-60'
      )}
    >
      {selectionSlot}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={<div ref={titleRef} />}
              className={cn(
                'block min-w-0 max-w-full truncate text-left text-sm font-medium text-foreground',
                isActiveRun && 'text-shimmer'
              )}
            >
              {automation.name}
              {automation.isDraft ? (
                <span className="text-muted-foreground ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                  Draft
                </span>
              ) : null}
            </TooltipTrigger>
            {isTitleTruncated ? <TooltipContent>{automation.name}</TooltipContent> : null}
          </Tooltip>
          {isActiveRun ? (
            <Loader2
              className="text-muted-foreground size-3.5 shrink-0 animate-spin"
              aria-label={isRunning ? 'Running' : 'Queued'}
            />
          ) : null}
        </div>

        <div className="text-muted-foreground flex min-w-0 items-center gap-3 text-xs">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Folder className="size-3 shrink-0" />
            <span className={cn('truncate', isDetached && 'text-destructive/80')}>
              {projectName ?? (isDetached ? "No project — can't run" : 'Unknown project')}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <Clock className="size-3 shrink-0" />
            <span className="truncate">{triggerLabel}</span>
          </span>
        </div>
      </div>

      <div className="flex max-w-[44%] min-w-0 shrink-0 items-center justify-end gap-2">
        {toolIcon}
        {latestRun ? (
          latestRunAt != null ? (
            <AbsoluteTime
              value={latestRunAt}
              className="text-muted-foreground min-w-0 truncate text-xs"
            />
          ) : null
        ) : (
          <span className="text-muted-foreground text-xs">
            {automation.isDraft ? 'Draft' : 'No runs yet'}
          </span>
        )}
      </div>
    </div>
  );

  if (!hasContextMenu) return row;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onEdit(automation)}>
          <Pencil />
          Edit automation
        </ContextMenuItem>
        {onRunNow ? (
          <ContextMenuItem disabled={!canRunNow} onClick={() => onRunNow(automation)}>
            <Play />
            Run now
          </ContextMenuItem>
        ) : null}
        {onToggleEnabled ? (
          <ContextMenuItem
            disabled={!canToggle}
            onClick={() => onToggleEnabled(automation, !automation.enabled)}
          >
            {automation.enabled ? <CirclePause /> : <CirclePlay />}
            {automation.enabled ? 'Pause schedule' : 'Resume schedule'}
          </ContextMenuItem>
        ) : null}
        {onCopy ? (
          <ContextMenuItem disabled={!canCopy} onClick={() => onCopy(automation)}>
            <Copy />
            Copy automation
          </ContextMenuItem>
        ) : null}
        {onDelete ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => onDelete(automation)}>
              <Trash2 />
              Delete automation
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});

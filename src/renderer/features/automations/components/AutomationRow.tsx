import {
  Bot,
  CheckIcon,
  CirclePause,
  CirclePlay,
  Clock,
  Folder,
  Loader2,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatRunStatusLabel, formatTriggerLabel } from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { useAutomationRunStatus } from '../automation-run-status-store';
import { automationTool } from '../automation-tools';
import { isActiveStatus } from '../run-status-styles';

interface AutomationRowProps {
  automation: Automation;
  recentRuns?: AutomationRun[];
  onEdit: (automation: Automation) => void;
  onRunNow?: (automation: Automation) => void;
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
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
  const isActiveRun = runStatus ? isActiveStatus(runStatus.status) : false;
  const isRunning = runStatus?.status === 'running';
  const tooltipLabel = primaryTool?.label ?? 'Automation';

  const latestRun = recentRuns && recentRuns.length > 0 ? recentRuns[0] : null;
  const latestRunStatusLabel = latestRun
    ? (formatRunStatusLabel(latestRun.status) ?? 'Success')
    : null;
  const latestRunIsFailed = latestRun?.status === 'failed';
  const latestRunAt =
    latestRun?.startedAt ?? latestRun?.scheduledAt ?? latestRun?.finishedAt ?? null;
  const triggerLabel = formatTriggerLabel(automation.trigger);

  const hasContextMenu = Boolean(onRunNow || onToggleEnabled || onDelete);
  const canRunNow = !automation.isDraft && !isDetached;
  const canToggle = !automation.isDraft && !isDetached;
  const selectable = Boolean(onToggleSelect);

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
        'group flex min-h-14 cursor-pointer items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-muted/20 focus:outline-none focus-visible:outline-none',
        dimmed && 'opacity-60'
      )}
    >
      {selectable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected ?? false}
          aria-label={`Select ${automation.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect?.();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            onToggleSelect?.();
          }}
          className={cn(
            'relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring',
            !isSelected &&
              'border border-border bg-background-1 text-foreground shadow-sm group-hover:border-transparent group-hover:bg-transparent group-hover:shadow-none'
          )}
        >
          {isSelected ? (
            <span
              aria-hidden
              className="flex size-4 items-center justify-center rounded-[4px] border border-primary bg-background-neutral text-foreground-neutral"
            >
              <CheckIcon absoluteStrokeWidth strokeWidth={3} className="size-3" />
            </span>
          ) : (
            <>
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center group-hover:hidden"
              >
                {primaryTool ? (
                  <AgentLogo
                    logo={primaryTool.logo}
                    alt={primaryTool.label}
                    isSvg={primaryTool.isSvg}
                    invertInDark={primaryTool.invertInDark}
                    className="size-5 rounded-sm"
                  />
                ) : (
                  <Bot className="size-5" />
                )}
              </span>
              <span
                aria-hidden
                className="hidden size-4 items-center justify-center rounded-[4px] border border-border-1 group-hover:flex"
              />
            </>
          )}
        </button>
      ) : (
        <Tooltip>
          <TooltipTrigger>
            <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background-1 text-foreground shadow-sm">
              {primaryTool ? (
                <AgentLogo
                  logo={primaryTool.logo}
                  alt={primaryTool.label}
                  isSvg={primaryTool.isSvg}
                  invertInDark={primaryTool.invertInDark}
                  className="size-5 rounded-sm"
                />
              ) : (
                <Bot className="size-5" />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>{tooltipLabel}</TooltipContent>
        </Tooltip>
      )}

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
                <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Draft
                </span>
              ) : null}
            </TooltipTrigger>
            {isTitleTruncated ? <TooltipContent>{automation.name}</TooltipContent> : null}
          </Tooltip>
          {isActiveRun ? (
            <Loader2
              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
              aria-label={isRunning ? 'Running' : 'Queued'}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
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

      <div className="flex shrink-0 items-center justify-end">
        {latestRun ? (
          <span
            className={cn(
              'flex items-center gap-1 text-xs text-muted-foreground',
              latestRunIsFailed && 'text-destructive'
            )}
          >
            <span>{latestRunStatusLabel}</span>
            {latestRunAt != null ? (
              <>
                <span className="text-muted-foreground/40">·</span>
                <AbsoluteTime value={latestRunAt} />
              </>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
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

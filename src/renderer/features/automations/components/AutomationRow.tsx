import {
  Bot,
  CirclePause,
  CirclePlay,
  Folder,
  History,
  Loader2,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatRunStatusLabel } from '@shared/automations/format';
import type { Automation, AutomationRun, AutomationRunStatus } from '@shared/automations/types';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { useAutomationRunStatus } from '../automation-run-status-store';
import { collectTools } from '../automation-tools';

const SPARKLINE_SIZE = 6;

interface AutomationRowProps {
  automation: Automation;
  recentRuns?: AutomationRun[];
  busy?: boolean;
  onEdit: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onRunNow: (automation: Automation) => void;
  onSetEnabled: (automation: Automation, enabled: boolean) => void;
  onShowRuns: (automation: Automation) => void;
}

function runStatusBarClass(status: AutomationRunStatus): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-red-500';
    case 'running':
      return 'bg-blue-500';
    case 'queued':
      return 'bg-amber-500';
    case 'skipped':
      return 'bg-muted-foreground/40';
  }
}

export const AutomationRow = observer(function AutomationRow({
  automation,
  recentRuns,
  busy,
  onEdit,
  onDelete,
  onRunNow,
  onSetEnabled,
  onShowRuns,
}: AutomationRowProps) {
  const tools = useMemo(() => collectTools(automation), [automation]);
  const runStatus = useAutomationRunStatus(automation.id);
  const primaryTool = tools[0];

  const projectName = projectDisplayName(getProjectStore(automation.projectId));

  const titleRef = useRef<HTMLButtonElement>(null);
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
  const isActiveRun = runStatus?.status === 'queued' || runStatus?.status === 'running';
  const isRunning = runStatus?.status === 'running';
  const tooltipLabel = primaryTool?.label ?? 'Automation';

  const sparklineSlots = useMemo<Array<AutomationRun | null>>(() => {
    const slots: Array<AutomationRun | null> = Array.from({ length: SPARKLINE_SIZE }, () => null);
    if (!recentRuns) return slots;
    const ordered = recentRuns.slice(0, SPARKLINE_SIZE).slice().reverse();
    const offset = SPARKLINE_SIZE - ordered.length;
    for (let i = 0; i < ordered.length; i++) slots[offset + i] = ordered[i];
    return slots;
  }, [recentRuns]);
  const hasAnyRun = recentRuns ? recentRuns.length > 0 : false;
  const latestRun = hasAnyRun && recentRuns ? recentRuns[0] : null;
  const latestRunStatusLabel = latestRun
    ? (formatRunStatusLabel(latestRun.status) ?? 'Success')
    : null;
  const latestRunIsFailed = latestRun?.status === 'failed';

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();
    onEdit(automation);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(automation)}
      onKeyDown={handleRowKeyDown}
      aria-label={`Edit ${automation.name}`}
      className={cn(
        'group flex min-h-14 cursor-pointer items-center gap-4 px-1 py-2.5 text-left transition-colors hover:bg-muted/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        dimmed && 'opacity-60'
      )}
    >
      <Tooltip>
        <TooltipTrigger>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
            {primaryTool ? (
              <AgentLogo
                logo={primaryTool.logo}
                alt={primaryTool.label}
                isSvg={primaryTool.isSvg}
                invertInDark={primaryTool.invertInDark}
                className="size-4 rounded-sm"
              />
            ) : (
              <Bot className="size-4" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              ref={titleRef}
              onClick={(event) => {
                event.stopPropagation();
                onEdit(automation);
              }}
              className={cn(
                'block min-w-0 max-w-full truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
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

        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Folder className="size-3 shrink-0" />
          <span className="truncate">{projectName ?? 'Unknown project'}</span>
        </div>
      </div>

      <div className="relative flex min-w-44 shrink-0 flex-col items-end justify-center gap-1 self-stretch">
        <div className="flex w-full items-center justify-end gap-2 transition-all duration-150 ease-out group-hover:-translate-x-1 group-hover:opacity-0">
          {latestRun ? (
            <span
              className={cn(
                'flex items-center gap-1 truncate text-xs text-muted-foreground',
                latestRunIsFailed && 'text-destructive'
              )}
            >
              <span>{latestRunStatusLabel}</span>
              <span className="text-muted-foreground/40">·</span>
              <RelativeTime
                value={
                  latestRun.startedAt ?? latestRun.scheduledAt ?? latestRun.finishedAt ?? Date.now()
                }
                compact
                ago
              />
            </span>
          ) : null}
          {hasAnyRun ? (
            <div className="flex items-end gap-0.5" aria-hidden>
              {sparklineSlots.map((run, index) => (
                <span
                  key={run?.id ?? `empty-${index}`}
                  className={cn(
                    'h-3 w-0.5 rounded-sm',
                    run ? runStatusBarClass(run.status) : 'bg-muted-foreground/30'
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {automation.isDraft ? 'Draft' : 'No runs yet'}
            </div>
          )}
        </div>

        <div
          className="absolute right-0 top-1/2 flex -translate-y-1/2 translate-x-2 items-center justify-end gap-0.5 opacity-0 transition-all duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger
              disabled={automation.isDraft || busy || isActiveRun}
              onClick={() => onRunNow(automation)}
              aria-label={`Run ${automation.name} now`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              {isActiveRun ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {runStatus?.status === 'queued' ? 'Queued' : isRunning ? 'Running' : 'Run now'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => onShowRuns(automation)}
              aria-label={`Show run history for ${automation.name}`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <History className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Run history</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => onEdit(automation)}
              aria-label={`Edit ${automation.name}`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Pencil className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              disabled={automation.isDraft}
              onClick={() => onSetEnabled(automation, !automation.enabled)}
              aria-label={`${automation.enabled ? 'Pause' : 'Resume'} ${automation.name}`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {automation.enabled ? (
                <CirclePause className="size-4" />
              ) : (
                <CirclePlay className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {automation.isDraft
                ? 'Start from draft to enable'
                : automation.enabled
                  ? 'Pause'
                  : 'Resume'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => onDelete(automation)}
              aria-label={`Delete ${automation.name}`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Trash2 className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});

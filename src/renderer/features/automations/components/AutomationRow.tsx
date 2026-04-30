import { Bot, CirclePause, CirclePlay, History, Loader2, Pencil, Play, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import githubSvg from '@/assets/images/Github.svg?raw';
import type { ActionSpec } from '@shared/automations/actions';
import { formatTriggerLabel } from '@shared/automations/format';
import type { Automation } from '@shared/automations/types';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { useAutomationRunStatus } from '../automation-run-status-store';

type Tool = {
  id: string;
  label: string;
  logo: string;
  isSvg?: boolean;
  invertInDark?: boolean;
};

function actionTool(action: ActionSpec): Tool | null {
  const cfg = action.provider ? agentConfig[action.provider] : undefined;
  if (!cfg) return null;
  return {
    id: `agent:${action.provider}`,
    label: cfg.name,
    logo: cfg.logo,
    isSvg: cfg.isSvg,
    invertInDark: cfg.invertInDark,
  };
}

function collectTools(automation: Automation): Tool[] {
  const seen = new Set<string>();
  const tools: Tool[] = [];
  for (const action of automation.actions) {
    const tool = actionTool(action);
    if (!tool || seen.has(tool.id)) continue;
    seen.add(tool.id);
    tools.push(tool);
  }
  return tools;
}

interface AutomationRowProps {
  automation: Automation;
  busy?: boolean;
  onEdit: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onRunNow: (automation: Automation) => void;
  onSetEnabled: (automation: Automation, enabled: boolean) => void;
  onShowRuns: (automation: Automation) => void;
}

export const AutomationRow = observer(function AutomationRow({
  automation,
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
  const triggerLabel = formatTriggerLabel(automation.trigger);

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

  const dimmed = !automation.enabled;
  const isRunning = runStatus?.status === 'running';
  const isGithubTriggered = automation.trigger.kind === 'event';
  const tooltipLabel = isGithubTriggered
    ? primaryTool
      ? `${primaryTool.label} · GitHub`
      : 'GitHub automation'
    : (primaryTool?.label ?? 'Automation');

  return (
    <div
      className={`group flex min-h-12 items-center gap-4 px-1 py-2.5 text-left transition-colors hover:bg-muted/20 ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      <Tooltip>
        <TooltipTrigger>
          <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
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
            {isGithubTriggered ? (
              <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm">
                <AgentLogo logo={githubSvg} alt="GitHub" isSvg className="size-2.5 rounded-full" />
              </span>
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            ref={titleRef}
            onClick={() => onEdit(automation)}
            className={cn(
              'block min-w-0 max-w-full truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              isRunning && 'text-shimmer'
            )}
          >
            {automation.name}
          </TooltipTrigger>
          {isTitleTruncated ? <TooltipContent>{automation.name}</TooltipContent> : null}
        </Tooltip>
      </div>

      <div className="relative flex h-8 min-w-36 shrink-0 items-center justify-end">
        <div className="max-w-48 truncate text-right text-xs text-muted-foreground transition-all duration-150 ease-out group-hover:-translate-x-1 group-hover:opacity-0">
          {triggerLabel}
        </div>
        <div
          className="absolute right-0 flex translate-x-2 items-center justify-end gap-0.5 opacity-0 transition-all duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger
              disabled={busy || isRunning}
              onClick={() => onRunNow(automation)}
              aria-label={`Run ${automation.name} now`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              {isRunning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipContent>{isRunning ? 'Running' : 'Run now'}</TooltipContent>
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
            <TooltipContent>{automation.enabled ? 'Pause' : 'Resume'}</TooltipContent>
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

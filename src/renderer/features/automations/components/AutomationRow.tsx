import {
  CheckCircle2,
  CircleAlert,
  CircleMinus,
  History,
  Loader2,
  Pencil,
  Play,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActionSpec } from '@shared/automations/actions';
import type { Automation, AutomationRunStatus } from '@shared/automations/types';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { Badge } from '@renderer/lib/ui/badge';
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

function statusMeta(status: AutomationRunStatus) {
  switch (status) {
    case 'running':
      return {
        label: 'Running',
        icon: Loader2,
        className: 'border-blue-500/30 bg-blue-500/10 text-blue-500',
        iconClassName: 'animate-spin',
      };
    case 'success':
      return {
        label: 'Succeeded',
        icon: CheckCircle2,
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
        iconClassName: '',
      };
    case 'failed':
      return {
        label: 'Failed',
        icon: CircleAlert,
        className: 'border-destructive/30 bg-destructive/10 text-destructive',
        iconClassName: '',
      };
    case 'skipped':
      return {
        label: 'Skipped',
        icon: CircleMinus,
        className: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
        iconClassName: '',
      };
  }
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
  const visibleTools = tools.slice(0, 3);
  const overflow = tools.length - visibleTools.length;

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
  const runStatusMeta = runStatus ? statusMeta(runStatus.status) : null;
  const StatusIcon = runStatusMeta?.icon;
  const runStatusTooltip =
    runStatus?.status === 'running' ? 'Automation is running' : 'Latest run finished';

  return (
    <div
      className={`group flex items-center gap-4 px-1 py-3 text-left transition-colors hover:bg-muted/20 ${
        dimmed ? 'opacity-60' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              ref={titleRef}
              onClick={() => onEdit(automation)}
              className="block min-w-0 max-w-full truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {automation.name}
            </TooltipTrigger>
            {isTitleTruncated ? <TooltipContent>{automation.name}</TooltipContent> : null}
          </Tooltip>
          {runStatusMeta && StatusIcon ? (
            <Tooltip>
              <TooltipTrigger>
                <Badge
                  variant="outline"
                  className={cn('h-5 shrink-0 gap-1 px-1.5 text-[10px]', runStatusMeta.className)}
                >
                  <StatusIcon className={cn('size-3', runStatusMeta.iconClassName)} />
                  {runStatusMeta.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{runStatusTooltip}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        {visibleTools.length > 0 ? (
          <div className="flex items-center gap-1.5">
            {visibleTools.map((tool) => (
              <Tooltip key={tool.id}>
                <TooltipTrigger>
                  <span className="flex size-4 items-center justify-center text-muted-foreground">
                    <AgentLogo
                      logo={tool.logo}
                      alt={tool.label}
                      isSvg={tool.isSvg}
                      invertInDark={tool.invertInDark}
                      className="size-4 rounded-sm"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{tool.label}</TooltipContent>
              </Tooltip>
            ))}
            {overflow > 0 && (
              <span className="text-[10px] font-medium text-muted-foreground">+{overflow}</span>
            )}
          </div>
        ) : null}
      </div>

      <div
        className="flex shrink-0 items-center justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger
            disabled={busy || runStatus?.status === 'running'}
            onClick={() => onRunNow(automation)}
            aria-label={`Run ${automation.name} now`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          >
            {runStatus?.status === 'running' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
          </TooltipTrigger>
          <TooltipContent>{runStatus?.status === 'running' ? 'Running' : 'Run now'}</TooltipContent>
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
            aria-label={`${automation.enabled ? 'Disable' : 'Enable'} ${automation.name}`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {automation.enabled ? <PowerOff className="size-4" /> : <Power className="size-4" />}
          </TooltipTrigger>
          <TooltipContent>{automation.enabled ? 'Disable' : 'Enable'}</TooltipContent>
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
  );
});

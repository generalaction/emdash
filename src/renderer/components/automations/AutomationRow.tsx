import React from 'react';
import {
  Pause,
  Play,
  Trash2,
  Pencil,
  Zap,
  Clock,
  GitPullRequest,
  CircleDot,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Spinner } from '../ui/spinner';
import AgentLogo from '../AgentLogo';
import { agentConfig } from '../../lib/agentConfig';
import { useRunningAutomations, getPhaseLabel } from './useRunningAutomations';
import type { Automation } from '@shared/automations/types';
import type { Project } from '../../types/app';
import {
  formatScheduleLabel,
  formatRelativeTime,
  formatTriggerLabel,
  TRIGGER_INTEGRATION_MAP,
} from './utils';
import { INTEGRATION_LABELS } from '@shared/integrations/types';
import type { IntegrationStatusMap } from '@shared/integrations/types';
import type { Agent } from '../../types';

interface AutomationRowProps {
  automation: Automation;
  projects: Project[];
  integrationStatuses?: IntegrationStatusMap;
  onEdit: (automation: Automation) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onTriggerNow: (id: string) => void;
  onViewLogs: (automation: Automation) => void;
}

function getTriggerIcon(triggerType: string): React.ReactNode {
  if (triggerType === 'github_pr') return <GitPullRequest className="h-3 w-3" />;
  if (triggerType === 'linear_issue') return <CircleDot className="h-3 w-3" />;
  return <Zap className="h-3 w-3" />;
}

const AutomationRow: React.FC<AutomationRowProps> = ({
  automation,
  projects,
  integrationStatuses,
  onEdit,
  onToggle,
  onDelete,
  onTriggerNow,
  onViewLogs,
}) => {
  const agent = agentConfig[automation.agentId as Agent];
  const project = projects.find((p) => p.id === automation.projectId);
  const isActive = automation.status === 'active';

  // Check if the required integration is connected for trigger automations
  const requiredIntegration =
    automation.mode === 'trigger' && automation.triggerType
      ? TRIGGER_INTEGRATION_MAP[automation.triggerType]
      : null;
  const isIntegrationDisconnected =
    requiredIntegration && integrationStatuses ? !integrationStatuses[requiredIntegration] : false;

  const { getRunState } = useRunningAutomations();
  const runState = getRunState(automation.id);
  const isTriggering = !!runState && runState.phase !== 'error';
  const canRunNow = automation.mode !== 'trigger' && !isTriggering;

  const projectLabel =
    project?.githubInfo?.connected && project?.githubInfo?.repository
      ? project.githubInfo.repository
      : (project?.name ?? automation.projectName ?? 'Unknown');

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={`group flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-4 transition-all hover:bg-muted/40 ${
          !isActive && !isTriggering ? 'opacity-45' : ''
        }`}
      >
        {/* Agent icon */}
        {agent?.logo ? (
          <AgentLogo
            logo={agent.logo}
            alt={agent.name}
            isSvg={agent.isSvg}
            invertInDark={agent.invertInDark}
            className="h-5 w-5 shrink-0 rounded-sm"
          />
        ) : (
          <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-muted-foreground">
            {automation.agentId.slice(0, 2).toUpperCase()}
          </span>
        )}

        {/* Name + project */}
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-semibold text-foreground">{automation.name}</span>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{projectLabel}</p>
        </div>

        {/* Running indicator */}
        {isTriggering && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner size="sm" className="h-3 w-3" />
            <span className="hidden sm:inline">{getPhaseLabel(runState.phase)}</span>
          </span>
        )}

        {/* Integration disconnected warning */}
        {!isTriggering && isIntegrationDisconnected && requiredIntegration && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role="status"
                aria-label={`${INTEGRATION_LABELS[requiredIntegration]} not connected`}
                className="flex items-center gap-1 text-xs text-amber-500"
              >
                <AlertTriangle className="h-3 w-3" />
                <span className="hidden sm:inline">
                  {INTEGRATION_LABELS[requiredIntegration]} not connected
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Connect {INTEGRATION_LABELS[requiredIntegration]} in Settings → Integrations
            </TooltipContent>
          </Tooltip>
        )}

        {/* Schedule / trigger info */}
        {!isTriggering &&
          automation.mode === 'trigger' &&
          automation.triggerType &&
          !isIntegrationDisconnected && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground/40 sm:flex">
              {getTriggerIcon(automation.triggerType)}
              {formatTriggerLabel(automation.triggerType)}
            </span>
          )}
        {!isTriggering && automation.mode !== 'trigger' && (
          <span className="hidden items-center gap-1 text-xs text-muted-foreground/40 sm:flex">
            <Clock className="h-3 w-3" />
            {formatScheduleLabel(automation.schedule)}
          </span>
        )}

        {/* Next run / last run */}
        {!isTriggering && automation.nextRunAt && isActive && automation.mode !== 'trigger' && (
          <span className="hidden text-xs text-muted-foreground/40 lg:inline">
            next {formatRelativeTime(automation.nextRunAt)}
          </span>
        )}

        {/* Run count link */}
        {automation.runCount > 0 && !isTriggering && (
          <button
            type="button"
            className="hidden text-xs text-muted-foreground/30 transition-colors hover:text-foreground/60 sm:inline"
            aria-label={`View ${automation.runCount} run${automation.runCount !== 1 ? 's' : ''} for ${automation.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onViewLogs(automation);
            }}
          >
            {automation.runCount} run{automation.runCount !== 1 ? 's' : ''}
          </button>
        )}

        {/* Status label */}
        {!isTriggering && (
          <span
            className={`text-xs font-medium ${
              isActive ? 'text-emerald-500/70' : 'text-muted-foreground/40'
            }`}
          >
            {isActive ? 'Active' : 'Paused'}
          </span>
        )}

        {/* Actions — visible on hover */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canRunNow) return;
                    onTriggerNow(automation.id);
                  }}
                  aria-label="Run now"
                  className="h-7 w-7 text-muted-foreground"
                  disabled={!canRunNow}
                >
                  <Zap className="h-3.5 w-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {automation.mode === 'trigger'
                ? 'Run now is unavailable for event-triggered automations'
                : 'Run now'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(automation.id);
                }}
                aria-label={isActive ? 'Pause' : 'Resume'}
                className="h-7 w-7 text-muted-foreground"
                disabled={isTriggering}
              >
                {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{isActive ? 'Pause' : 'Resume'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(automation);
                }}
                aria-label="Edit"
                className="h-7 w-7 text-muted-foreground"
                disabled={isTriggering}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(automation.id);
                }}
                aria-label="Delete"
                className="h-7 w-7 text-destructive/60"
                disabled={isTriggering}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default AutomationRow;

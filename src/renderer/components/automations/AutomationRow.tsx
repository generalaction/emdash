import React from 'react';
import { Pause, Play, Trash2, Pencil, Zap, Clock } from 'lucide-react';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import AgentLogo from '../AgentLogo';
import { agentConfig } from '../../lib/agentConfig';
import { useRunningAutomations, getPhaseLabel } from './useRunningAutomations';
import type { Automation } from '@shared/automations/types';
import type { Project } from '../../types/app';
import { formatScheduleLabel, formatRelativeTime } from './utils';
import type { Agent } from '../../types';

interface AutomationRowProps {
  automation: Automation;
  projects: Project[];
  onEdit: (automation: Automation) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onTriggerNow: (id: string) => void;
  onViewLogs: (automation: Automation) => void;
}

const AutomationRow: React.FC<AutomationRowProps> = ({
  automation,
  projects,
  onEdit,
  onToggle,
  onDelete,
  onTriggerNow,
  onViewLogs,
}) => {
  const agent = agentConfig[automation.agentId as Agent];
  const project = projects.find((p) => p.id === automation.projectId);
  const isActive = automation.status === 'active';
  const isPaused = automation.status !== 'active';

  const { getRunState } = useRunningAutomations();
  const runState = getRunState(automation.id);
  const isTriggering = !!runState && runState.phase !== 'error';

  const projectLabel =
    project?.githubInfo?.connected && project?.githubInfo?.repository
      ? project.githubInfo.repository
      : (project?.name ?? automation.projectName ?? 'Unknown');

  return (
    <div
      className={`group flex items-center gap-3 py-3 transition-colors ${
        isPaused && !isTriggering ? 'opacity-45' : ''
      }`}
    >
      {/* Agent icon */}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-muted/40">
        {agent?.logo ? (
          <AgentLogo
            logo={agent.logo}
            alt={agent.name}
            isSvg={agent.isSvg}
            invertInDark={agent.invertInDark}
            className="h-4 w-4"
          />
        ) : (
          <span className="text-[9px] font-semibold text-muted-foreground">
            {automation.agentId.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      {/* Name + project */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{automation.name}</span>
        <span className="hidden truncate text-xs text-muted-foreground/50 sm:inline">
          {projectLabel}
        </span>
      </div>

      {/* Running indicator */}
      {isTriggering && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner size="sm" className="h-3 w-3" />
          <span className="hidden sm:inline">{getPhaseLabel(runState.phase)}</span>
        </span>
      )}

      {/* Schedule info */}
      {!isTriggering && (
        <span className="hidden items-center gap-1 text-xs text-muted-foreground/40 sm:flex">
          <Clock className="h-3 w-3" />
          {formatScheduleLabel(automation.schedule)}
        </span>
      )}

      {/* Next run / last run */}
      {!isTriggering && automation.nextRunAt && isActive && (
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
      <span
        className={`text-xs font-medium ${
          isActive ? 'text-emerald-500/70' : 'text-muted-foreground/40'
        }`}
      >
        {isTriggering ? '' : isActive ? 'Active' : 'Paused'}
      </span>

      {/* Actions — visible on hover */}
      <div className="flex shrink-0 items-center gap-0 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            onTriggerNow(automation.id);
          }}
          aria-label="Run now"
          className="h-6 w-6 text-muted-foreground"
          disabled={isTriggering}
        >
          <Zap className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(automation.id);
          }}
          aria-label={isActive ? 'Pause' : 'Resume'}
          className="h-6 w-6 text-muted-foreground"
          disabled={isTriggering}
        >
          {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(automation);
          }}
          aria-label="Edit"
          className="h-6 w-6 text-muted-foreground"
          disabled={isTriggering}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(automation.id);
          }}
          aria-label="Delete"
          className="h-6 w-6 text-destructive/60"
          disabled={isTriggering}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};

export default AutomationRow;

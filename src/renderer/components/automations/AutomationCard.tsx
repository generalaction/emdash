import React from 'react';
import { Clock, Pause, Play, Trash2, Pencil, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import type { Automation } from '@shared/automations/types';
import { getProvider } from '@shared/providers/registry';
import { formatScheduleLabel, formatRelativeTime } from './utils';

interface AutomationCardProps {
  automation: Automation;
  onEdit: (automation: Automation) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onTriggerNow: (id: string) => void;
  onViewLogs: (automation: Automation) => void;
}

const AutomationCard: React.FC<AutomationCardProps> = ({
  automation,
  onEdit,
  onToggle,
  onDelete,
  onTriggerNow,
  onViewLogs,
}) => {
  const provider = getProvider(automation.agentId as any);
  const isActive = automation.status === 'active';
  const isPaused = automation.status === 'paused';

  return (
    <div
      className={`group relative rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20 ${
        isPaused ? 'opacity-60' : ''
      }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium">{automation.name}</h3>
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : isPaused
                    ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}
            >
              {automation.status}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {automation.projectName || 'Unknown project'}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onToggle(automation.id)}
            aria-label={isActive ? 'Pause' : 'Resume'}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(automation)}
            aria-label="Edit"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onTriggerNow(automation.id)}
            aria-label="Run now"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Zap className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(automation.id)}
            aria-label="Delete"
            className="text-destructive opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Prompt preview */}
      <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{automation.prompt}</p>

      {/* Footer info */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatScheduleLabel(automation.schedule)}
          </span>
          <span className="font-medium text-foreground/70">
            {provider?.name ?? automation.agentId}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {automation.lastRunAt && (
            <span className="flex items-center gap-1">
              {automation.lastRunResult === 'success' ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : automation.lastRunResult === 'failure' ? (
                <XCircle className="h-3 w-3 text-red-500" />
              ) : null}
              {formatRelativeTime(automation.lastRunAt)}
            </span>
          )}
          {automation.nextRunAt && isActive && (
            <span>Next: {formatRelativeTime(automation.nextRunAt)}</span>
          )}
        </div>
      </div>

      {automation.runCount > 0 && (
        <button
          type="button"
          className="mt-2 text-[10px] text-muted-foreground/60 hover:text-foreground/70"
          onClick={() => onViewLogs(automation)}
        >
          {automation.runCount} run{automation.runCount !== 1 ? 's' : ''} total
        </button>
      )}
    </div>
  );
};

export default AutomationCard;

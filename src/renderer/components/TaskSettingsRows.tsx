import React from 'react';
import { Info } from 'lucide-react';
import { Switch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { agentMeta } from '../providers/meta';
import type { TaskSettingsModel } from '../hooks/useTaskSettings';

const SUPPORTED_AUTO_APPROVE_AGENTS = Object.values(agentMeta)
  .filter((meta) => Boolean(meta.autoApproveFlag))
  .map((meta) => meta.label)
  .sort((a, b) => a.localeCompare(b))
  .join(', ');

interface RowProps {
  taskSettings: TaskSettingsModel;
}

export const AutoGenerateTaskNamesRow: React.FC<RowProps> = ({ taskSettings }) => {
  const showError =
    Boolean(taskSettings.error) &&
    (taskSettings.errorScope === 'autoGenerateName' || taskSettings.errorScope === 'load');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Auto-generate task names</p>
          <p className="text-sm text-muted-foreground">
            Automatically suggests a task name when creating a new task.
          </p>
        </div>
        <Switch
          checked={taskSettings.autoGenerateName}
          disabled={taskSettings.loading || taskSettings.saving}
          onCheckedChange={taskSettings.updateAutoGenerateName}
        />
      </div>
      {showError ? <p className="text-xs text-destructive">{taskSettings.error}</p> : null}
    </div>
  );
};

export const AutoApproveByDefaultRow: React.FC<RowProps> = ({ taskSettings }) => {
  const showError =
    Boolean(taskSettings.error) && taskSettings.errorScope === 'autoApproveByDefault';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-foreground">Auto-approve by default</p>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label="Show supported agents for auto-approve"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  Supported by: {SUPPORTED_AUTO_APPROVE_AGENTS}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-sm text-muted-foreground">
            Skips permission prompts for file operations in new tasks.
          </p>
        </div>
        <Switch
          checked={taskSettings.autoApproveByDefault}
          disabled={taskSettings.loading || taskSettings.saving}
          onCheckedChange={taskSettings.updateAutoApproveByDefault}
        />
      </div>
      {showError ? <p className="text-xs text-destructive">{taskSettings.error}</p> : null}
    </div>
  );
};

export const AutoTrustWorktreesRow: React.FC<RowProps> = ({ taskSettings }) => {
  const showError = Boolean(taskSettings.error) && taskSettings.errorScope === 'autoTrustWorktrees';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-foreground">Auto-trust worktree directories</p>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label="More info about auto-trust worktrees"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  Only applies to Claude Code. Writes trust entries to ~/.claude.json before
                  launching.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-sm text-muted-foreground">
            Skip the folder trust prompt in Claude Code for new tasks.
          </p>
        </div>
        <Switch
          checked={taskSettings.autoTrustWorktrees}
          disabled={taskSettings.loading || taskSettings.saving}
          onCheckedChange={taskSettings.updateAutoTrustWorktrees}
        />
      </div>
      {showError ? <p className="text-xs text-destructive">{taskSettings.error}</p> : null}
    </div>
  );
};

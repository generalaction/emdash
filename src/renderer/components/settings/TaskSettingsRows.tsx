import { Info } from 'lucide-react';
import React from 'react';
import { useTaskSettings } from '../../hooks/useTaskSettings';
import { agentMeta } from '../../providers/meta';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

const SUPPORTED_AUTO_APPROVE_AGENTS = Object.values(agentMeta)
  .filter((meta) => Boolean(meta.autoApproveFlag))
  .map((meta) => meta.label)
  .sort((a, b) => a.localeCompare(b))
  .join(', ');

export const AutoGenerateTaskNamesRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
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
  );
};

export const AutoApproveByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-foreground">Auto-approve by default</p>
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger>
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
  );
};

export const AutoTrustWorktreesRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-foreground">Auto-trust worktree directories</p>
          <TooltipProvider delay={150}>
            <Tooltip>
              <TooltipTrigger>
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
  );
};

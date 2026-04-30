import { Info } from 'lucide-react';
import React from 'react';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

function InfoTooltip({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={label}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const AutoGenerateTaskNamesRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Auto-generate task names"
      description="Automatically suggests a task name when creating a new task."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoGenerateName')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoGenerateName}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoGenerateName}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoGenerateName}
          />
        </>
      }
    />
  );
};

export const AutoTrustWorktreesRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={
        <div className="flex items-center gap-1.5">
          Auto-trust worktree directories
          <InfoTooltip
            label="More info about auto-trust worktrees"
            content="Only applies to Claude Code. Writes trust entries to ~/.claude.json before launching."
          />
        </div>
      }
      description="Skip the folder trust prompt in Claude Code for new tasks."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoTrustWorktrees')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoTrustWorktrees}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoTrustWorktrees}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoTrustWorktrees}
          />
        </>
      }
    />
  );
};

export const KeepAwakeWhileRunningRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={
        <div className="flex items-center gap-1.5">
          Keep computer awake while tasks run
          <InfoTooltip
            label="More info about keep-awake"
            content="Prevents the system from sleeping or starting the display sleep timer while at least one task session is active. Releases the lock once all sessions exit."
          />
        </div>
      }
      description="Block sleep and display dimming whenever a task session is running."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('keepAwakeWhileRunning')}
            defaultLabel="off"
            onReset={taskSettings.resetKeepAwakeWhileRunning}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.keepAwakeWhileRunning}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateKeepAwakeWhileRunning}
          />
        </>
      }
    />
  );
};

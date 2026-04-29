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

export const AutoRenameFromFirstPromptRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Auto-rename task from first prompt"
      description="After you send the first prompt in a new task, replace the auto-generated name with one derived from the prompt."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoRenameFromFirstPrompt')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoRenameFromFirstPrompt}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoRenameFromFirstPrompt}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoRenameFromFirstPrompt}
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

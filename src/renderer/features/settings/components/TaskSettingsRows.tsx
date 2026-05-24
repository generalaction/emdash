import { Info } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
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
            className="text-muted-foreground inline-flex size-4 items-center justify-center hover:text-foreground"
            aria-label={label}
          >
            <Info className="size-3.5" />
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

export const CreateBranchAndWorktreeRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Create branch and worktree by default"
      description="Start new From Branch tasks in a dedicated task branch and worktree unless changed in the task modal."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('createBranchAndWorktree')}
            defaultLabel="on"
            onReset={taskSettings.resetCreateBranchAndWorktree}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.createBranchAndWorktree}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateCreateBranchAndWorktree}
          />
        </>
      }
    />
  );
};

export const IncludeIssueContextByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Include issue context by default"
      description="Add the selected issue to the initial agent prompt when creating a task from an issue."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('includeIssueContextByDefault')}
            defaultLabel="on"
            onReset={taskSettings.resetIncludeIssueContextByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.includeIssueContextByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateIncludeIssueContextByDefault}
          />
        </>
      }
    />
  );
};

export const EnableTmuxRow: React.FC = () => {
  const {
    value: projects,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('project');

  const tmuxByDefault = projects?.tmuxByDefault ?? false;

  return (
    <SettingRow
      title="Enable tmux"
      description="Run agent sessions and terminals in tmux sessions by default."
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('tmuxByDefault')}
            defaultLabel="off"
            onReset={() => resetField('tmuxByDefault')}
            disabled={loading || saving}
          />
          <Switch
            checked={tmuxByDefault}
            disabled={loading || saving}
            onCheckedChange={(checked) => update({ tmuxByDefault: checked })}
          />
        </>
      }
    />
  );
};

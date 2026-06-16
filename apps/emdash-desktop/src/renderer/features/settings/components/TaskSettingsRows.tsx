import { Info } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { TaskDeleteBehavior } from '@shared/core/app-settings';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

function InfoTooltip({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            className="text-muted-foreground inline-flex h-4 w-4 items-center justify-center hover:text-foreground"
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
            content="Applies to Claude Code and GitHub Copilot. Writes trust entries before launching."
          />
        </div>
      }
      description="Skip the folder trust prompt in supported CLIs for new tasks."
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

export const PreserveTaskNameCapitalizationRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Preserve task name capitalization"
      description="Keep uppercase letters in generated and manually entered task names. Defaults to lowercase."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('preserveNameCapitalization')}
            defaultLabel="off"
            onReset={taskSettings.resetPreserveNameCapitalization}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.preserveNameCapitalization}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updatePreserveNameCapitalization}
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

export const TaskDeleteBehaviorRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Task delete behavior"
      description="Choose whether deleting a task also deletes its worktree and branch automatically."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('deleteBehavior')}
            defaultLabel="ask"
            onReset={taskSettings.resetDeleteBehavior}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Select
            value={taskSettings.deleteBehavior}
            onValueChange={(next) => taskSettings.updateDeleteBehavior(next as TaskDeleteBehavior)}
          >
            <SelectTrigger className="w-auto shrink-0 gap-2 [&>span]:line-clamp-none">
              <SelectValue>
                {taskSettings.deleteBehavior === 'ask'
                  ? 'Ask every time'
                  : 'Delete worktree and branch'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="min-w-max">
              <SelectItem value="delete-worktree-and-branch">Delete worktree and branch</SelectItem>
              <SelectItem value="ask">Ask every time</SelectItem>
            </SelectContent>
          </Select>
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

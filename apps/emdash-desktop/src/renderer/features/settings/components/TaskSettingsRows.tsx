import { Info } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { type DurationUnit, durationToMs, msToDuration } from '@renderer/lib/duration';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Input } from '@renderer/lib/ui/input';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
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

export const AutoApproveByDefaultRow: React.FC = () => {
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title="Auto-approve by default"
      description="Skip permission prompts for supported agents when creating new tasks and conversations."
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoApproveByDefault')}
            defaultLabel="off"
            onReset={taskSettings.resetAutoApproveByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoApproveByDefault}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoApproveByDefault}
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

export const AutoCleanupMergedTasksRow: React.FC = () => {
  const taskSettings = useTaskSettings();
  const { value, unit } = msToDuration(taskSettings.autoCleanupMergedDelayMs);
  const disabled =
    taskSettings.loading || taskSettings.saving || !taskSettings.autoCleanupMergedEnabled;

  const updateValue = (nextValue: number) => {
    const clamped = Math.max(1, Math.floor(nextValue));
    taskSettings.updateAutoCleanupMergedDelayMs(durationToMs(clamped, unit));
  };

  const updateUnit = (nextUnit: DurationUnit) => {
    taskSettings.updateAutoCleanupMergedDelayMs(durationToMs(value, nextUnit));
  };

  const anyOverridden =
    taskSettings.isFieldOverridden('autoCleanupMergedEnabled') ||
    taskSettings.isFieldOverridden('autoCleanupMergedAction') ||
    taskSettings.isFieldOverridden('autoCleanupMergedDeleteBranch') ||
    taskSettings.isFieldOverridden('autoCleanupMergedDelayMs');

  const resetAll = () => {
    taskSettings.resetAutoCleanupMergedEnabled();
    taskSettings.resetAutoCleanupMergedAction();
    taskSettings.resetAutoCleanupMergedDeleteBranch();
    taskSettings.resetAutoCleanupMergedDelayMs();
  };

  return (
    <SettingRow
      title="Auto-cleanup merged tasks"
      description="When a task's pull request has been merged for the configured delay, automatically archive or delete the task."
      control={
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            <ResetToDefaultButton
              visible={anyOverridden}
              defaultLabel="off"
              onReset={resetAll}
              disabled={taskSettings.loading || taskSettings.saving}
            />
            <Switch
              checked={taskSettings.autoCleanupMergedEnabled}
              disabled={taskSettings.loading || taskSettings.saving}
              onCheckedChange={taskSettings.updateAutoCleanupMergedEnabled}
            />
          </div>

          <RadioGroup
            value={taskSettings.autoCleanupMergedAction}
            onValueChange={(v) =>
              taskSettings.updateAutoCleanupMergedAction(v as 'archive' | 'delete')
            }
            disabled={disabled}
            className="flex items-center gap-4 text-sm"
          >
            <label className="flex items-center gap-1.5">
              <RadioGroupItem value="archive" />
              Archive
            </label>
            <label className="flex items-center gap-1.5">
              <RadioGroupItem value="delete" />
              Delete
            </label>
          </RadioGroup>

          {taskSettings.autoCleanupMergedAction === 'delete' && (
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={taskSettings.autoCleanupMergedDeleteBranch}
                disabled={disabled}
                onCheckedChange={(c) =>
                  taskSettings.updateAutoCleanupMergedDeleteBranch(c === true)
                }
              />
              Also delete the branch
            </label>
          )}

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">After</span>
            <Input
              type="number"
              min={1}
              value={value}
              disabled={disabled}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0) updateValue(n);
              }}
              className="w-20"
            />
            <Select
              value={unit}
              onValueChange={(u) => updateUnit(u as DurationUnit)}
              disabled={disabled}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
                <SelectItem value="days">Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      }
    />
  );
};

import { Info } from 'lucide-react';
import React from 'react';
import { Switch } from '../../../components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip';
import { useTaskSettings } from '../../../hooks/useTaskSettings';
import { agentMeta } from '../../../providers/meta';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const SUPPORTED_AUTO_APPROVE_AGENTS = Object.values(agentMeta)
  .filter((meta) => Boolean(meta.autoApproveFlag))
  .map((meta) => meta.label)
  .sort((a, b) => a.localeCompare(b))
  .join(', ');

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
          {taskSettings.isFieldOverridden('autoGenerateName') && (
            <ResetToDefaultButton
              defaultLabel="on"
              onReset={taskSettings.resetAutoGenerateName}
              disabled={taskSettings.loading || taskSettings.saving}
            />
          )}
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
      title={
        <div className="flex items-center gap-1.5">
          Auto-approve by default
          <InfoTooltip
            label="Show supported agents for auto-approve"
            content={`Supported by: ${SUPPORTED_AUTO_APPROVE_AGENTS}`}
          />
        </div>
      }
      description="Skips permission prompts for file operations in new tasks."
      control={
        <>
          {taskSettings.isFieldOverridden('autoApproveByDefault') && (
            <ResetToDefaultButton
              defaultLabel="off"
              onReset={taskSettings.resetAutoApproveByDefault}
              disabled={taskSettings.loading || taskSettings.saving}
            />
          )}
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
            content="Only applies to Claude Code. Writes trust entries to ~/.claude.json before launching."
          />
        </div>
      }
      description="Skip the folder trust prompt in Claude Code for new tasks."
      control={
        <>
          {taskSettings.isFieldOverridden('autoTrustWorktrees') && (
            <ResetToDefaultButton
              defaultLabel="on"
              onReset={taskSettings.resetAutoTrustWorktrees}
              disabled={taskSettings.loading || taskSettings.saving}
            />
          )}
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

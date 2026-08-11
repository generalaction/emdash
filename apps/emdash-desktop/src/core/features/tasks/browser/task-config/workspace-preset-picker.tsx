import { Select } from '@emdash/ui/react/primitives';
import {
  ChevronsUpDown,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  GitPullRequestArrow,
  Layers,
} from 'lucide-react';
import React from 'react';
import { useTaskConfig } from '@core/features/tasks/contributions/browser/task-config/task-config-context';
import { cn } from '@core/primitives/styling/browser/cn';
import type { WorkspacePresetId, WorkspacePresetMeta } from '@core/primitives/workspaces/api';
import { WORKSPACE_PRESETS } from '@core/primitives/workspaces/api';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const PRESET_ICONS: Record<WorkspacePresetId, React.ReactNode> = {
  'new-worktree': <GitBranch className="size-3.5 shrink-0" />,
  'repo-root': <FolderGit2 className="size-3.5 shrink-0" />,
  'use-existing': <Layers className="size-3.5 shrink-0" />,
  'checkout-pr': <GitPullRequest className="size-3.5 shrink-0" />,
  'pr-new-branch': <GitPullRequestArrow className="size-3.5 shrink-0" />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PresetOption = WorkspacePresetMeta & {
  disabled: boolean;
  disabledReason?: string;
};

interface WorkspacePresetPickerProps {
  value: WorkspacePresetId;
  onValueChange: (id: WorkspacePresetId) => void;
  hasPR: boolean;
  hasExistingWorkspaces: boolean;
  worktreesDisabledReason?: string;
  disabled?: boolean;
}

export function WorkspacePresetPicker({
  value,
  onValueChange,
  hasPR,
  hasExistingWorkspaces,
  worktreesDisabledReason,
  disabled,
}: WorkspacePresetPickerProps) {
  const { showPrPresets } = useTaskConfig();

  const options: PresetOption[] = WORKSPACE_PRESETS.filter(
    (preset) => showPrPresets || !preset.requiresPR
  ).map((preset) => ({
    ...preset,
    disabledReason:
      preset.requiresCommits && worktreesDisabledReason ? worktreesDisabledReason : undefined,
    disabled:
      (preset.requiresPR && !hasPR) ||
      (hasPR && !preset.requiresPR) ||
      (preset.requiresCommits && !!worktreesDisabledReason) ||
      (preset.id === 'use-existing' && !hasExistingWorkspaces),
  }));

  const selected = options.find((o) => o.id === value) ?? options[0];

  return (
    <Select.Root
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as WorkspacePresetId)}
      disabled={disabled}
    >
      <Select.Trigger
        appearance="input"
        showChevron={false}
        style={{ height: 'auto', minHeight: '4.25rem' }}
        className={cn(
          'data-popup-open:border-ring flex w-full items-center justify-between gap-2 rounded-lg border border-border py-2 px-2.5  text-sm outline-none transition-colors hover:bg-background-2',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-foreground-muted">{PRESET_ICONS[value]}</span>
            <span className="truncate">{selected?.label ?? 'Select workspace…'}</span>
          </div>
          <span className="text-xs text-foreground-muted">
            {selected?.disabledReason ?? selected?.description}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-foreground-passive" />
      </Select.Trigger>

      <Select.Content width="trigger" align="start">
        {options.map((option) => (
          <Select.Item
            key={option.id}
            value={option.id}
            disabled={option.disabled}
            className="items-start rounded-md px-2.5 py-2"
          >
            <span className="flex flex-col items-start gap-1.5">
              <span className="flex gap-1.5">
                <span
                  className={cn(
                    'mt-px shrink-0',
                    option.disabled ? 'text-foreground-passive' : 'text-foreground-muted'
                  )}
                >
                  {PRESET_ICONS[option.id]}
                </span>
                <span className="text-sm leading-none">{option.label}</span>
              </span>
              <span className="text-xs leading-snug text-foreground-muted">
                {option.disabledReason ?? option.description}
              </span>
            </span>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

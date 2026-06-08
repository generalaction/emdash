import {
  ChevronDown,
  ChevronsUpDown,
  Cloud,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  GitPullRequestArrow,
  Layers,
} from 'lucide-react';
import React, { useState } from 'react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { cn } from '@renderer/utils/utils';
import type {
  WorkspacePresetId,
  WorkspacePresetMeta,
} from '@shared/core/workspaces/workspace-presets';
import { WORKSPACE_PRESETS } from '@shared/core/workspaces/workspace-presets';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const PRESET_ICONS: Record<WorkspacePresetId, React.ReactNode> = {
  'new-worktree': <GitBranch className="size-4 shrink-0" />,
  'repo-root': <FolderGit2 className="size-4 shrink-0" />,
  'use-existing': <Layers className="size-4 shrink-0" />,
  'checkout-pr': <GitPullRequest className="size-4 shrink-0" />,
  'pr-new-branch': <GitPullRequestArrow className="size-4 shrink-0" />,
  sandbox: <Cloud className="size-4 shrink-0" />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PresetOption = WorkspacePresetMeta & { disabled: boolean };

interface WorkspacePresetPickerProps {
  value: WorkspacePresetId;
  onValueChange: (id: WorkspacePresetId) => void;
  hasPR: boolean;
  isWorkspaceProviderEnabled: boolean;
  hasExistingWorkspaces: boolean;
  disabled?: boolean;
}

export function WorkspacePresetPicker({
  value,
  onValueChange,
  hasPR,
  isWorkspaceProviderEnabled,
  hasExistingWorkspaces,
  disabled,
}: WorkspacePresetPickerProps) {
  const options: PresetOption[] = WORKSPACE_PRESETS.map((preset) => ({
    ...preset,
    disabled:
      (preset.requiresPR && !hasPR) ||
      (preset.requiresBYOI && !isWorkspaceProviderEnabled) ||
      (preset.id === 'use-existing' && !hasExistingWorkspaces),
  }));

  const selected = options.find((o) => o.id === value) ?? options[0];
  const [query, setQuery] = useState('');

  const filtered = query
    ? options.filter((o) => {
        const q = query.toLowerCase();
        return o.label.toLowerCase().includes(q) || o.description.toLowerCase().includes(q);
      })
    : options;

  return (
    <Combobox
      value={selected}
      onValueChange={(item: PresetOption | null) => {
        if (item && !item.disabled) onValueChange(item.id);
      }}
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      isItemEqualToValue={(a: PresetOption, b: PresetOption) => a.id === b.id}
      disabled={disabled}
    >
      <ComboboxTrigger
        className={cn(
          'data-popup-open:border-ring flex w-full items-center justify-between gap-2 rounded-md border border-border p-2 px-2.5 text-sm outline-none transition-colors hover:bg-background-2',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="flex min-w-0  flex-col gap-1.5">
          <div className="flex items-center gap-2">
          <span className="text-foreground-muted">{PRESET_ICONS[value]}</span>
          <span className="truncate">{selected?.label ?? 'Select workspace…'}</span>
          </div>
          <span className="text-xs text-foreground-muted">{selected?.description}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-foreground-passive" />
      </ComboboxTrigger>

      <ComboboxContent>
        <ComboboxInput
          value={query}
          onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Search…"
          showTrigger={false}
        />
        <ComboboxList>
          {filtered.map((option) => (
            <ComboboxItem
              key={option.id}
              value={option}
              disabled={option.disabled}
              showCheck={false}
              className="items-start py-2 pr-3"
            >
              <span className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-px shrink-0',
                    option.disabled ? 'text-foreground-passive' : 'text-foreground-muted'
                  )}
                >
                  {PRESET_ICONS[option.id]}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm leading-none font-medium">{option.label}</span>
                  <span className="text-xs leading-snug text-foreground-muted">
                    {option.description}
                  </span>
                </span>
              </span>
            </ComboboxItem>
          ))}
          <ComboboxEmpty>No matching workspace type</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

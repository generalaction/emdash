import { cn } from '@renderer/utils/utils';
import type { WorkspaceMode } from './use-workspace-config';
import { Box, FolderSearch, TreePine } from 'lucide-react';

interface WorkspaceModePickerProps {
  value: WorkspaceMode;
  onValueChange: (mode: WorkspaceMode) => void;
  hasExistingWorkspaces: boolean;
  isWorkspaceProviderEnabled: boolean;
  isUnborn: boolean;
  disabled?: boolean;
}

const MODES: {
  value: WorkspaceMode;
  label: string;
  description: string;
  hidden?: (p: WorkspaceModePickerProps) => boolean;
  icon?: React.ReactNode;
}[] = [
  {
    value: 'new-worktree',
    label: 'New worktree',
    icon: <TreePine className="size-3.5" />,
    description: 'Create a branch and isolated working directory',
    hidden: (p) => p.isUnborn,
  },
  {
    value: 'existing',
    label: 'Existing workspace',
    icon: <FolderSearch className="size-3.5" />,
    description: 'Reuse an existing worktree or the project root',
    hidden: (p) => !p.hasExistingWorkspaces,
  },
  {
    value: 'sandbox',
    label: 'Sandbox (BYOI)',
    icon: <Box className="size-3.5" />,
    description: 'Provision an isolated remote workspace',
    hidden: (p) => !p.isWorkspaceProviderEnabled,
  },
];

export function WorkspaceModePicker({
  value,
  onValueChange,
  hasExistingWorkspaces,
  isWorkspaceProviderEnabled,
  isUnborn,
  disabled,
}: WorkspaceModePickerProps) {
  const props = {
    value,
    onValueChange,
    hasExistingWorkspaces,
    isWorkspaceProviderEnabled,
    isUnborn,
    disabled,
  };
  const visible = MODES.filter((m) => !m.hidden?.(props));

  if (visible.length === 0) return null;

  return (
    <div className="flex gap-2">
      {visible.map((mode) => {
        const selected = value === mode.value;
        return (
          <button
            key={mode.value}
            type="button"
            disabled={disabled}
            onClick={() => onValueChange(mode.value)}
            className={cn(
              'flex flex-1 flex-col gap-2 rounded-md border p-2 text-left transition-colors bg-background-1',
              selected
                ? 'border-primary bg-background-3 text-foreground'
                : 'border-border text-foreground hover:border-border-strong hover:bg-background-2',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <span className="text-sm leading-none flex items-center gap-1.5">{mode.icon} {mode.label}</span>
            <span className="text-xs text-foreground-muted">{mode.description}</span>
          </button>
        );
      })}
    </div>
  );
}

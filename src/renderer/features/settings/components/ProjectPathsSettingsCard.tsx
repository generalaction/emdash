import { Folder } from 'lucide-react';
import React, { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { ResetToDefaultButton } from './ResetToDefaultButton';

function DirectoryPicker({
  title,
  message,
  path,
  placeholder,
  onPathChange,
  disabled,
}: {
  title: string;
  message: string;
  path: string | undefined;
  placeholder: string;
  onPathChange: (path: string) => void;
  disabled?: boolean;
}) {
  const handleOpen = useCallback(async () => {
    const result = await rpc.app.openSelectDirectoryDialog({
      title,
      message,
      defaultPath: path,
    });
    if (result) onPathChange(result);
  }, [title, message, path, onPathChange]);

  return (
    <button
      type="button"
      onClick={() => void handleOpen()}
      disabled={disabled}
      className="group flex h-9 w-full items-center gap-2 rounded-md border border-border p-2 pr-1.5 transition-colors hover:bg-background-quaternary-1 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Folder className="size-4 text-foreground-muted" />
      <p
        className={cn(
          'min-w-0 flex-1 truncate text-left text-sm',
          path ? 'text-foreground' : 'text-foreground-passive'
        )}
      >
        {path || placeholder}
      </p>
      <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-border bg-background px-2 text-xs text-foreground-muted group-hover:text-foreground">
        Choose
      </span>
    </button>
  );
}

export const ProjectPathsSettingsCard: React.FC = () => {
  const {
    value,
    defaults,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('localProject');

  const projectsDir = value?.defaultProjectsDirectory ?? '';
  const worktreeDir = value?.defaultWorktreeDirectory ?? '';

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm text-foreground">Default projects directory</label>
          {isFieldOverridden('defaultProjectsDirectory') && (
            <ResetToDefaultButton
              defaultLabel={defaults?.defaultProjectsDirectory ?? ''}
              onReset={() => resetField('defaultProjectsDirectory')}
              disabled={loading || saving}
            />
          )}
        </div>
        <DirectoryPicker
          title="Default projects directory"
          message="Used as the starting location when importing or creating projects"
          path={projectsDir}
          placeholder="Choose a folder"
          onPathChange={(path) => update({ defaultProjectsDirectory: path })}
          disabled={loading || saving}
        />
        <p className="text-xs text-foreground-passive">
          Emdash opens this folder when you import a project or pick a location.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm text-foreground">Default worktrees directory</label>
          {isFieldOverridden('defaultWorktreeDirectory') && (
            <ResetToDefaultButton
              defaultLabel={defaults?.defaultWorktreeDirectory ?? ''}
              onReset={() => resetField('defaultWorktreeDirectory')}
              disabled={loading || saving}
            />
          )}
        </div>
        <DirectoryPicker
          title="Default worktrees directory"
          message="Where new worktrees are placed when tasks are created"
          path={worktreeDir}
          placeholder="Choose a folder"
          onPathChange={(path) => update({ defaultWorktreeDirectory: path })}
          disabled={loading || saving}
        />
        <p className="text-xs text-foreground-passive">
          Worktrees created by tasks land here unless overridden per project.
        </p>
      </div>
    </div>
  );
};

export default ProjectPathsSettingsCard;

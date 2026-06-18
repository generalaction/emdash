import { Folder } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { normalizeBranchPrefix } from '@shared/util/branch-prefix';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const RepositorySettingsCard: React.FC = () => {
  const {
    value: project,
    update: updateProject,
    isLoading: projectLoading,
    isSaving: projectSaving,
    isFieldOverridden: isProjectFieldOverridden,
    resetField: resetProjectField,
  } = useAppSettingsKey('project');
  const {
    value: localProject,
    update: updateLocalProject,
    updateAsync: updateLocalProjectAsync,
    isLoading: localProjectLoading,
    isSaving: localProjectSaving,
    isFieldOverridden: isLocalProjectFieldOverridden,
    resetField: resetLocalProjectField,
  } = useAppSettingsKey('localProject');
  const [isBrowsingWorktreeDirectory, setIsBrowsingWorktreeDirectory] = React.useState(false);
  const [defaultWorktreeDirectoryError, setDefaultWorktreeDirectoryError] = React.useState<
    string | null
  >(null);

  const branchPrefix = project?.branchPrefix ?? '';
  const appendRandomBranchSuffix = project?.appendRandomBranchSuffix ?? true;
  const pushOnCreate = project?.pushOnCreate ?? true;
  const defaultWorktreeDirectory = localProject?.defaultWorktreeDirectory ?? '';
  const writeAgentConfigToGitIgnore = localProject?.writeAgentConfigToGitIgnore ?? true;
  const projectBusy = projectLoading || projectSaving;
  const localProjectBusy = localProjectLoading || localProjectSaving;
  const defaultWorktreeDirectoryBusy = localProjectBusy || isBrowsingWorktreeDirectory;

  const updateDefaultWorktreeDirectory = async (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) {
      setDefaultWorktreeDirectoryError('Enter an absolute directory path.');
      return;
    }
    if (trimmed === defaultWorktreeDirectory) {
      setDefaultWorktreeDirectoryError(null);
      return;
    }

    try {
      await updateLocalProjectAsync({ defaultWorktreeDirectory: trimmed });
      setDefaultWorktreeDirectoryError(null);
    } catch {
      const message = 'Choose an absolute directory that Emdash can create and access.';
      setDefaultWorktreeDirectoryError(message);
      toast({
        title: 'Could not update default worktree directory',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const chooseDefaultWorktreeDirectory = async () => {
    if (isBrowsingWorktreeDirectory) return;

    setIsBrowsingWorktreeDirectory(true);
    try {
      const result = await rpc.app.openSelectDirectoryDialog({
        title: 'Select default worktree directory',
        message: 'Choose the default directory where new project worktrees should be created.',
        defaultPath: defaultWorktreeDirectory,
      });
      if (result) await updateDefaultWorktreeDirectory(result);
    } finally {
      setIsBrowsingWorktreeDirectory(false);
    }
  };

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Input
            key={branchPrefix}
            defaultValue={branchPrefix}
            onBlur={(e) => {
              const next = normalizeBranchPrefix(e.currentTarget.value);
              e.currentTarget.value = next;
              if (next !== branchPrefix) {
                updateProject({ branchPrefix: next });
              }
            }}
            placeholder="Branch prefix"
            aria-label="Branch prefix"
            disabled={projectBusy}
            className="flex-1"
          />
          <ResetToDefaultButton
            visible={isProjectFieldOverridden('branchPrefix')}
            defaultLabel="emdash"
            onReset={() => resetProjectField('branchPrefix')}
            disabled={projectBusy}
          />
        </div>
        <div className="text-xs text-foreground-passive">
          Leave empty to create branches without a prefix.
        </div>
      </div>
      <SettingRow
        title="Random branch suffix"
        description="Add a random suffix to branch names."
        control={
          <>
            <ResetToDefaultButton
              visible={isProjectFieldOverridden('appendRandomBranchSuffix')}
              defaultLabel="on"
              onReset={() => resetProjectField('appendRandomBranchSuffix')}
              disabled={projectBusy}
            />
            <Switch
              checked={appendRandomBranchSuffix}
              onCheckedChange={(checked) => updateProject({ appendRandomBranchSuffix: checked })}
              disabled={projectBusy}
              aria-label="Append random branch suffix"
            />
          </>
        }
      />
      <SettingRow
        title="Auto-push on create"
        description="Push the new branch to the selected project remote and set upstream after creation."
        control={
          <>
            <ResetToDefaultButton
              visible={isProjectFieldOverridden('pushOnCreate')}
              defaultLabel="on"
              onReset={() => resetProjectField('pushOnCreate')}
              disabled={projectBusy}
            />
            <Switch
              checked={pushOnCreate}
              onCheckedChange={(checked) => updateProject({ pushOnCreate: checked })}
              disabled={projectBusy}
              aria-label="Enable automatic push on create"
            />
          </>
        }
      />
      <div className="grid min-w-0 gap-2">
        <div className="grid gap-0.5">
          <div className="text-sm break-words text-foreground">Default worktree directory</div>
          <div className="text-xs break-words text-foreground-passive">
            Used for new worktrees unless a project has its own worktree directory.
          </div>
        </div>
        <div className="flex max-w-3xl min-w-0 items-center gap-2">
          <Input
            key={defaultWorktreeDirectory}
            defaultValue={defaultWorktreeDirectory}
            onBlur={(e) => {
              void updateDefaultWorktreeDirectory(e.currentTarget.value);
            }}
            placeholder="Default worktree directory"
            aria-label="Default worktree directory"
            aria-invalid={defaultWorktreeDirectoryError ? true : undefined}
            disabled={defaultWorktreeDirectoryBusy}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={defaultWorktreeDirectoryBusy}
            onClick={chooseDefaultWorktreeDirectory}
            aria-label="Choose default worktree directory"
            title="Choose default worktree directory"
          >
            <Folder className="size-4" />
          </Button>
          <ResetToDefaultButton
            visible={isLocalProjectFieldOverridden('defaultWorktreeDirectory')}
            defaultLabel="default"
            onReset={() => {
              setDefaultWorktreeDirectoryError(null);
              resetLocalProjectField('defaultWorktreeDirectory');
            }}
            disabled={defaultWorktreeDirectoryBusy}
          />
        </div>
        {defaultWorktreeDirectoryError ? (
          <div className="max-w-3xl text-xs text-foreground-error">
            {defaultWorktreeDirectoryError}
          </div>
        ) : null}
      </div>
      <SettingRow
        title="Auto-update .gitignore"
        description="When Emdash writes CLI hook configs, also add their paths to .gitignore."
        control={
          <>
            <ResetToDefaultButton
              visible={isLocalProjectFieldOverridden('writeAgentConfigToGitIgnore')}
              defaultLabel="on"
              onReset={() => resetLocalProjectField('writeAgentConfigToGitIgnore')}
              disabled={localProjectBusy}
            />
            <Switch
              checked={writeAgentConfigToGitIgnore}
              onCheckedChange={(checked) =>
                updateLocalProject({ writeAgentConfigToGitIgnore: checked })
              }
              disabled={localProjectBusy}
              aria-label="Enable .gitignore updates for CLI hook configs"
            />
          </>
        }
      />
    </div>
  );
};

export default RepositorySettingsCard;

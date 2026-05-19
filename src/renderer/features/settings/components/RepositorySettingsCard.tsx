import React, { useMemo } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
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
    isLoading: localProjectLoading,
    isSaving: localProjectSaving,
    isFieldOverridden: isLocalProjectFieldOverridden,
    resetField: resetLocalProjectField,
  } = useAppSettingsKey('localProject');

  const branchPrefix = project?.branchPrefix ?? '';
  const appendRandomBranchSuffix = project?.appendRandomBranchSuffix ?? true;
  const pushOnCreate = project?.pushOnCreate ?? true;
  const writeAgentConfigToGitIgnore = localProject?.writeAgentConfigToGitIgnore ?? true;
  const projectBusy = projectLoading || projectSaving;
  const localProjectBusy = localProjectLoading || localProjectSaving;

  const example = useMemo(() => {
    const prefix = branchPrefix ? `${branchPrefix}/` : '';
    const suffix = appendRandomBranchSuffix ? '-a3f' : '';
    return `${prefix}my-feature${suffix}`;
  }, [appendRandomBranchSuffix, branchPrefix]);

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Input
            key={branchPrefix}
            defaultValue={branchPrefix}
            onBlur={(e) => {
              const next = e.target.value.trim();
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
        <div className="text-[11px] text-muted-foreground">
          Leave blank to use the task branch name directly. Example:{' '}
          <code className="rounded bg-muted/60 px-1">{example}</code>
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

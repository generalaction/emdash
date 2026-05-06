import React, { useMemo } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const RepositorySettingsCard: React.FC = () => {
  const {
    value: localProject,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('localProject');

  const branchPrefix = localProject?.branchPrefix ?? '';
  const pushOnCreate = localProject?.pushOnCreate ?? true;
  const writeAgentConfigToGitIgnore = localProject?.writeAgentConfigToGitIgnore ?? true;

  const example = useMemo(() => {
    return `${branchPrefix}/my-feature-a3f`;
  }, [branchPrefix]);

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
                update({ branchPrefix: next });
              }
            }}
            placeholder="Branch prefix"
            aria-label="Branch prefix"
            disabled={loading}
            className="flex-1"
          />
          <ResetToDefaultButton
            visible={isFieldOverridden('branchPrefix')}
            defaultLabel="emdash"
            onReset={() => resetField('branchPrefix')}
            disabled={loading || saving}
          />
        </div>
        <div className="text-[11px] text-muted-foreground">
          Example: <code className="rounded bg-muted/60 px-1">{example}</code>
        </div>
      </div>
      <SettingRow
        title="Auto-push on create"
        description="Push the new branch to the selected project remote and set upstream after creation."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('pushOnCreate')}
              defaultLabel="on"
              onReset={() => resetField('pushOnCreate')}
              disabled={loading || saving}
            />
            <Switch
              checked={pushOnCreate}
              onCheckedChange={(checked) => update({ pushOnCreate: checked })}
              disabled={loading || saving}
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
              visible={isFieldOverridden('writeAgentConfigToGitIgnore')}
              defaultLabel="on"
              onReset={() => resetField('writeAgentConfigToGitIgnore')}
              disabled={loading || saving}
            />
            <Switch
              checked={writeAgentConfigToGitIgnore}
              onCheckedChange={(checked) => update({ writeAgentConfigToGitIgnore: checked })}
              disabled={loading || saving}
              aria-label="Enable .gitignore updates for CLI hook configs"
            />
          </>
        }
      />
    </div>
  );
};

export default RepositorySettingsCard;

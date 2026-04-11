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
          {isFieldOverridden('branchPrefix') && (
            <ResetToDefaultButton
              defaultLabel="emdash"
              onReset={() => resetField('branchPrefix')}
              disabled={loading || saving}
            />
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Example: <code className="rounded bg-muted/60 px-1">{example}</code>
        </div>
      </div>
      <SettingRow
        title="Auto-push to origin"
        description="Push the new branch to origin and set upstream after creation."
        control={
          <>
            {isFieldOverridden('pushOnCreate') && (
              <ResetToDefaultButton
                defaultLabel="on"
                onReset={() => resetField('pushOnCreate')}
                disabled={loading || saving}
              />
            )}
            <Switch
              checked={pushOnCreate}
              onCheckedChange={(checked) => update({ pushOnCreate: checked })}
              disabled={loading || saving}
              aria-label="Enable automatic push on create"
            />
          </>
        }
      />
    </div>
  );
};

export default RepositorySettingsCard;

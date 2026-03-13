import React, { useMemo } from 'react';
import { useAppSettingsKey } from '@renderer/contexts/AppSettingsProvider';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { ResetToDefaultButton } from './ResetToDefaultButton';

const RepositorySettingsCard: React.FC = () => {
  const {
    value: localProject,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('localProject');

  const example = useMemo(() => {
    const prefix = localProject?.branchPrefix ?? '';
    return `${prefix}/my-feature-a3f`;
  }, [localProject?.branchPrefix]);

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Input
            defaultValue={localProject?.branchPrefix ?? ''}
            onBlur={(e) => update({ branchPrefix: e.target.value.trim() })}
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
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="text-sm font-medium text-foreground">Auto-push to origin</div>
          <div className="text-sm">
            Push the new branch to origin and set upstream after creation.
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isFieldOverridden('pushOnCreate') && (
            <ResetToDefaultButton
              defaultLabel="on"
              onReset={() => resetField('pushOnCreate')}
              disabled={loading || saving}
            />
          )}
          <Switch
            defaultChecked={localProject?.pushOnCreate ?? true}
            onCheckedChange={(checked) => update({ pushOnCreate: checked })}
            disabled={loading || saving}
            aria-label="Enable automatic push on create"
          />
        </div>
      </div>
    </div>
  );
};

export default RepositorySettingsCard;

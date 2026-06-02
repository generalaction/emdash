import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Switch } from '@renderer/lib/ui/switch';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const SidebarMetadataSettingsCard: React.FC = () => {
  const {
    value: interfaceSettings,
    update,
    isLoading,
    isSaving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');

  const busy = isLoading || isSaving;
  const showLineChanges = interfaceSettings?.showLeftSidebarLineChanges ?? true;
  const showPrStatus = interfaceSettings?.showLeftSidebarPrStatus ?? true;
  const showTimestamps = interfaceSettings?.showLeftSidebarTimestamps ?? true;

  return (
    <div className="grid gap-4">
      <SettingRow
        title="Left sidebar line changes"
        description="Show added and removed line counts for tasks in the left sidebar."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('showLeftSidebarLineChanges')}
              defaultLabel="on"
              onReset={() => resetField('showLeftSidebarLineChanges')}
              disabled={busy}
            />
            <Switch
              checked={showLineChanges}
              onCheckedChange={(checked) => update({ showLeftSidebarLineChanges: checked })}
              disabled={busy}
              aria-label="Show left sidebar line changes"
            />
          </>
        }
      />
      <SettingRow
        title="Left sidebar PR status"
        description="Show GitHub PR merge and status icons for tasks in the left sidebar."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('showLeftSidebarPrStatus')}
              defaultLabel="on"
              onReset={() => resetField('showLeftSidebarPrStatus')}
              disabled={busy}
            />
            <Switch
              checked={showPrStatus}
              onCheckedChange={(checked) => update({ showLeftSidebarPrStatus: checked })}
              disabled={busy}
              aria-label="Show left sidebar PR status"
            />
          </>
        }
      />
      <SettingRow
        title="Left sidebar timestamps"
        description="Show the relative task timestamp in the left sidebar."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('showLeftSidebarTimestamps')}
              defaultLabel="on"
              onReset={() => resetField('showLeftSidebarTimestamps')}
              disabled={busy}
            />
            <Switch
              checked={showTimestamps}
              onCheckedChange={(checked) => update({ showLeftSidebarTimestamps: checked })}
              disabled={busy}
              aria-label="Show left sidebar timestamps"
            />
          </>
        }
      />
    </div>
  );
};

export default SidebarMetadataSettingsCard;

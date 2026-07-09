import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Switch } from '@renderer/lib/ui/switch';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const InterfaceSettingsCard: React.FC = () => {
  const {
    value: interfaceSettings,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');

  const hideContextBar = interfaceSettings?.hideContextBar ?? false;

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        settingId="context-bar"
        title="Context bar"
        description="Hide the on-screen context trigger. The keyboard shortcut still works."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('hideContextBar')}
              defaultLabel="shown"
              onReset={() => resetField('hideContextBar')}
              disabled={loading || saving}
            />
            <Switch
              checked={hideContextBar}
              disabled={loading || saving}
              onCheckedChange={(checked) => update({ hideContextBar: checked })}
            />
          </>
        }
      />
    </div>
  );
};

export default InterfaceSettingsCard;

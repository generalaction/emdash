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

  const confirmTabClose = interfaceSettings?.confirmTabClose ?? false;

  return (
    <SettingRow
      title="Confirm tab close"
      description="Ask for confirmation before closing a tab."
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('confirmTabClose')}
            defaultLabel="off"
            onReset={() => resetField('confirmTabClose')}
            disabled={loading || saving}
          />
          <Switch
            checked={confirmTabClose}
            disabled={loading || saving}
            onCheckedChange={(checked) => update({ confirmTabClose: checked })}
          />
        </>
      }
    />
  );
};

export default InterfaceSettingsCard;

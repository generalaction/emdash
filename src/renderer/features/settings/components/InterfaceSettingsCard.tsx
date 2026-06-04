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
  const hideContextBar = interfaceSettings?.hideContextBar ?? false;

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Context bar"
        description="Hide the conversation context actions if they obstruct your viewport."
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
    </div>
  );
};

export default InterfaceSettingsCard;

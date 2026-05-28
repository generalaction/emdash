import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Switch } from '@renderer/lib/ui/switch';
import { ConversationUiModeControl } from './ConversationUiModeControl';
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
  const conversationUiMode = interfaceSettings?.conversationUiMode ?? 'terminal';

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Default conversation UI"
        description="Choose how new agent conversations open."
        control={
          <ConversationUiModeControl
            conversationUiMode={conversationUiMode}
            isOverridden={isFieldOverridden('conversationUiMode')}
            disabled={loading || saving}
            onUpdate={(mode) => update({ conversationUiMode: mode })}
            onReset={() => resetField('conversationUiMode')}
          />
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

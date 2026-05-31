import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
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
  const contextBarPosition = interfaceSettings?.contextBarPosition ?? 'bottom';
  const contextBarAlignment = interfaceSettings?.contextBarAlignment ?? 'center';
  const contextBarHidden = contextBarPosition === 'hidden';

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Context bar"
        description="Choose where the conversation context actions are docked, or hide them."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('contextBarPosition')}
              defaultLabel="bottom"
              onReset={() => resetField('contextBarPosition')}
              disabled={loading || saving}
            />
            <Select
              value={contextBarPosition}
              onValueChange={(value) =>
                update({
                  contextBarPosition: value as typeof contextBarPosition,
                })
              }
              disabled={loading || saving}
            >
              <SelectTrigger className="w-28 shrink-0 capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" className="min-w-max">
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
                <SelectItem value="hidden">Hidden</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
      <SettingRow
        title="Context bar alignment"
        description="Align the context actions within the bar."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('contextBarAlignment')}
              defaultLabel="center"
              onReset={() => resetField('contextBarAlignment')}
              disabled={loading || saving}
            />
            <Select
              value={contextBarAlignment}
              onValueChange={(value) =>
                update({
                  contextBarAlignment: value as typeof contextBarAlignment,
                })
              }
              disabled={loading || saving || contextBarHidden}
            >
              <SelectTrigger className="w-28 shrink-0 capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" className="min-w-max">
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
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

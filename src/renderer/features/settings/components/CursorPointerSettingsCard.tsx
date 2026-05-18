import React, { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

const CursorPointerSettingsCard: React.FC = () => {
  const {
    value: interfaceSettings,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('interface');

  const enabled = interfaceSettings?.cursorPointer ?? false;

  const toggle = useCallback(
    (next: boolean) => {
      update({ cursorPointer: next });
    },
    [update]
  );

  return (
    <SettingRow
      title="Pointer cursor on clickable elements"
      description="Show the pointer cursor on buttons, links, and other interactive elements when hovering."
      control={<Switch checked={enabled} disabled={loading || saving} onCheckedChange={toggle} />}
    />
  );
};

export default CursorPointerSettingsCard;

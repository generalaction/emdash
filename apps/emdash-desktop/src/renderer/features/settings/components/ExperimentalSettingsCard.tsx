import { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

export function ExperimentalSettingsCard() {
  const {
    value: experiments,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('experiments');

  const loopsEnabled = experiments?.loops ?? false;

  const toggleLoops = useCallback(
    (next: boolean) => {
      update({ loops: next });
    },
    [update]
  );

  return (
    <SettingRow
      title="Loops"
      description="Enable Create Task authoring and pinned task tabs for autonomous phased Loops."
      control={
        <Switch checked={loopsEnabled} disabled={loading || saving} onCheckedChange={toggleLoops} />
      }
    />
  );
}

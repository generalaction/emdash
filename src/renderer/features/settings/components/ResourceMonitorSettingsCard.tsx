import React, { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

const ResourceMonitorSettingsCard: React.FC = () => {
  const {
    value: resourceMonitor,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('resourceMonitor');

  const enabled = resourceMonitor?.enabled ?? false;

  const toggle = useCallback(
    (next: boolean) => {
      update({ enabled: next });
    },
    [update]
  );

  return (
    <SettingRow
      title="Resource monitor"
      description="Track CPU and memory usage for running agents. When enabled, open it from the command palette."
      control={<Switch checked={enabled} disabled={loading || saving} onCheckedChange={toggle} />}
    />
  );
};

export default ResourceMonitorSettingsCard;

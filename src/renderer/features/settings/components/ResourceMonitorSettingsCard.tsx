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
      description="Show CPU and memory usage for running agents in the sidebar. Samples every 1.5s while enabled."
      control={<Switch checked={enabled} disabled={loading || saving} onCheckedChange={toggle} />}
    />
  );
};

export default ResourceMonitorSettingsCard;

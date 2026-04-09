import React from 'react';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

const ResourceMonitorSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading, isSaving } = useAppSettings();

  const showResourceMonitor = settings?.interface?.showResourceMonitor ?? false;

  return (
    <div id="resource-monitor-settings-card" className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          Show resource monitor in titlebar
        </span>
        <span className="text-sm text-muted-foreground">
          Display the CPU and memory monitor chip in the app header.
        </span>
      </div>
      <Switch
        checked={showResourceMonitor}
        defaultChecked={showResourceMonitor}
        disabled={isLoading || isSaving}
        onCheckedChange={(checked) =>
          updateSettings({ interface: { showResourceMonitor: checked } })
        }
      />
    </div>
  );
};

export default ResourceMonitorSettingsCard;

import React from 'react';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

export default function BrowserPreviewSettingsCard() {
  const { settings, updateSettings, isLoading, isSaving } = useAppSettings();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Show localhost links in browser</span>
        <span className="text-sm text-muted-foreground">
          Preview UI changes using the built-in browser view.
        </span>
      </div>
      <Switch
        checked={settings?.browserPreview?.enabled ?? true}
        disabled={isLoading || isSaving}
        onCheckedChange={(next) => updateSettings({ browserPreview: { enabled: next } })}
      />
    </div>
  );
}

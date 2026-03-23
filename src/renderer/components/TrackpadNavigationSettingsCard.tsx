import React from 'react';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

/** Settings toggle for enabling/disabling trackpad swipe navigation gestures. */
export default function TrackpadNavigationSettingsCard() {
  const { settings, updateSettings, isLoading, isSaving } = useAppSettings();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Trackpad swipe navigation</span>
        <span className="text-sm text-muted-foreground">
          Navigate back and forward between views using trackpad swipe gestures.
        </span>
      </div>
      <Switch
        checked={settings?.navigation?.trackpadSwipe ?? true}
        disabled={isLoading || isSaving}
        onCheckedChange={(next) => updateSettings({ navigation: { trackpadSwipe: next } })}
      />
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Switch } from './ui/switch';

const NotificationSettingsCard: React.FC = () => {
  const [enabled, setEnabled] = useState(true);
  const [sound, setSound] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (result.success && result.settings) {
          const en = Boolean(result.settings.notifications?.enabled ?? true);
          const snd = Boolean(result.settings.notifications?.sound ?? true);
          setEnabled(en);
          setSound(snd);
        }
      } catch (error) {
        console.error('Failed to load notification settings:', error);
      }
      setLoading(false);
    })();
  }, []);

  const updateEnabled = async (next: boolean) => {
    setEnabled(next);
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('notification_settings_changed', { enabled: next, sound });
    });
    try {
      await window.electronAPI.updateSettings({
        notifications: { enabled: next, sound },
      });
    } catch (error) {
      console.error('Failed to update notification enabled setting:', error);
    }
  };

  const updateSound = async (next: boolean) => {
    setSound(next);
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('notification_settings_changed', { enabled, sound: next });
    });
    try {
      await window.electronAPI.updateSettings({
        notifications: { enabled, sound: next },
      });
    } catch (error) {
      console.error('Failed to update notification sound setting:', error);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">Notifications</p>
        <p className="text-sm text-muted-foreground">Get notified when agents complete tasks.</p>
      </div>
      <Switch checked={enabled} disabled={loading} onCheckedChange={updateEnabled} />
    </div>
  );
};

export default NotificationSettingsCard;

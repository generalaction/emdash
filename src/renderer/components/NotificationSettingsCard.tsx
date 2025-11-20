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
    try {
      await window.electronAPI.updateSettings({
        notifications: { enabled, sound: next },
      });
    } catch (error) {
      console.error('Failed to update notification sound setting:', error);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-4 text-sm text-muted-foreground">
        Get notified when agents complete tasks.
      </div>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-2">
          <span className="text-sm">Enable notifications</span>
          <Switch checked={enabled} disabled={loading} onCheckedChange={updateEnabled} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span className="text-sm">Enable sound</span>
          <Switch checked={sound} disabled={loading || !enabled} onCheckedChange={updateSound} />
        </label>
      </div>
    </div>
  );
};

export default NotificationSettingsCard;

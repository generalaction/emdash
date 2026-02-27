import React, { useEffect, useState } from 'react';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from '@/lib/utils';
import { soundPlayer } from '../lib/soundPlayer';

const NotificationSettingsCard: React.FC = () => {
  const [enabled, setEnabled] = useState(true);
  const [sound, setSound] = useState(true);
  const [osNotifications, setOsNotifications] = useState(true);
  const [soundFocusMode, setSoundFocusMode] = useState<'always' | 'unfocused'>('always');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (result.success && result.settings) {
          const n = result.settings.notifications;
          setEnabled(Boolean(n?.enabled ?? true));
          setSound(Boolean(n?.sound ?? true));
          setOsNotifications(Boolean(n?.osNotifications ?? true));
          setSoundFocusMode(n?.soundFocusMode ?? 'always');
        }
      } catch (error) {
        console.error('Failed to load notification settings:', error);
      }
      setLoading(false);
    })();
  }, []);

  const updateEnabled = async (next: boolean) => {
    setEnabled(next);
    soundPlayer.setEnabled(next && sound);
    try {
      await window.electronAPI.updateSettings({
        notifications: { enabled: next },
      });
    } catch (error) {
      console.error('Failed to update notification enabled setting:', error);
    }
  };

  const updateSound = async (next: boolean) => {
    setSound(next);
    soundPlayer.setEnabled(enabled && next);
    try {
      await window.electronAPI.updateSettings({
        notifications: { sound: next },
      });
    } catch (error) {
      console.error('Failed to update notification sound setting:', error);
    }
  };

  const updateSoundFocusMode = async (next: 'always' | 'unfocused') => {
    setSoundFocusMode(next);
    soundPlayer.setFocusMode(next);
    try {
      await window.electronAPI.updateSettings({
        notifications: { soundFocusMode: next },
      });
    } catch (error) {
      console.error('Failed to update sound focus mode:', error);
    }
  };

  const updateOsNotifications = async (next: boolean) => {
    setOsNotifications(next);
    try {
      await window.electronAPI.updateSettings({
        notifications: { osNotifications: next },
      });
    } catch (error) {
      console.error('Failed to update OS notifications setting:', error);
    }
  };

  const subsDisabled = !enabled;

  return (
    <div className="flex flex-col gap-4">
      {/* Master toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Notifications</p>
          <p className="text-sm text-muted-foreground">
            Get notified when agents need your attention.
          </p>
        </div>
        <Switch checked={enabled} disabled={loading} onCheckedChange={updateEnabled} />
      </div>

      {/* Sub-settings */}
      <div
        className={cn('flex flex-col gap-3 pl-1', subsDisabled && 'pointer-events-none opacity-50')}
      >
        {/* Sound toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Sound</p>
            <p className="text-sm text-muted-foreground">Play audio cues for agent events.</p>
          </div>
          <Switch checked={sound} disabled={loading} onCheckedChange={updateSound} />
        </div>

        {/* Sound timing */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Sound timing</p>
            <p className="text-sm text-muted-foreground">When to play sounds.</p>
          </div>
          <Select value={soundFocusMode} onValueChange={updateSoundFocusMode}>
            <SelectTrigger className="w-auto shrink-0 gap-2 [&>span]:line-clamp-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="always">Always</SelectItem>
              <SelectItem value="unfocused">Only when unfocused</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* OS notifications toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">OS notifications</p>
            <p className="text-sm text-muted-foreground">
              Show system banners when agents need attention or finish (while Emdash is unfocused).
            </p>
          </div>
          <Switch
            checked={osNotifications}
            disabled={loading}
            onCheckedChange={updateOsNotifications}
          />
        </div>
      </div>
    </div>
  );
};

export default NotificationSettingsCard;

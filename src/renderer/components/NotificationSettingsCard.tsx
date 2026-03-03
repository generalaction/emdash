import React from 'react';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from '@/lib/utils';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

const NotificationSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading } = useAppSettings();

  const { notifications } = settings ?? {};

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
        <Switch
          checked={notifications?.enabled ?? true}
          disabled={loading}
          onCheckedChange={(next) => updateSettings({ notifications: { enabled: next } })}
        />
      </div>

      {/* Sub-settings */}
      <div
        className={cn(
          'flex flex-col gap-3 pl-1',
          !notifications?.enabled && 'pointer-events-none opacity-50'
        )}
      >
        {/* Sound toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Sound</p>
            <p className="text-sm text-muted-foreground">Play audio cues for agent events.</p>
          </div>
          <Switch
            checked={notifications?.sound ?? true}
            disabled={loading}
            onCheckedChange={(next) => updateSettings({ notifications: { sound: next } })}
          />
        </div>

        {/* Sound timing */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Sound timing</p>
            <p className="text-sm text-muted-foreground">When to play sounds.</p>
          </div>
          <Select
            value={notifications?.soundFocusMode ?? 'always'}
            onValueChange={(next) =>
              updateSettings({ notifications: { soundFocusMode: next as 'always' | 'unfocused' } })
            }
          >
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
            checked={notifications?.osNotifications ?? true}
            disabled={loading}
            onCheckedChange={(next) => updateSettings({ notifications: { osNotifications: next } })}
          />
        </div>
      </div>
    </div>
  );
};

export default NotificationSettingsCard;

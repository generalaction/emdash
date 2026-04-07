import React from 'react';
import { Info } from 'lucide-react';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { cn } from '@/lib/utils';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { soundPlayer } from '@/lib/soundPlayer';
import type { NotificationSoundProfile } from '@shared/notificationSounds';

const NotificationSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading } = useAppSettings();

  const { notifications } = settings ?? {};

  const handleSoundProfileChange = (next: string) => {
    const nextProfile = next as NotificationSoundProfile;
    soundPlayer.preview(nextProfile);
    updateSettings({
      notifications: { soundProfile: nextProfile },
    });
  };

  return (
    <div id="notification-settings-card" className="flex flex-col gap-4">
      {/* Master toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-foreground">Notifications</p>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label="Show supported agents for notifications"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  Supported by Claude Code, Codex, Droid, and OpenCode.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
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

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Sound profile</p>
            <p className="text-sm text-muted-foreground">
              Switch between the classic Emdash chime and the Gilfoyle bitcoin alert.
            </p>
          </div>
          <Select
            value={notifications?.soundProfile ?? 'default'}
            onValueChange={handleSoundProfileChange}
          >
            <SelectTrigger className="w-auto shrink-0 gap-2 [&>span]:line-clamp-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="gilfoyle">Gilfoyle Bitcoin Alert</SelectItem>
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

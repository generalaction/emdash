import React from 'react';
import { useAppSettingsKey } from '@renderer/contexts/AppSettingsProvider';
import { cn } from '@renderer/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { ResetToDefaultButton } from './ResetToDefaultButton';

const NotificationSettingsCard: React.FC = () => {
  const {
    value: notifications,
    update,
    isLoading: loading,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('notifications');

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
        <div className="flex items-center gap-1">
          {isFieldOverridden('enabled') && (
            <ResetToDefaultButton
              defaultLabel="on"
              onReset={() => resetField('enabled')}
              disabled={loading}
            />
          )}
          <Switch
            checked={notifications?.enabled ?? true}
            disabled={loading}
            onCheckedChange={(next) => update({ enabled: next })}
          />
        </div>
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
          <div className="flex items-center gap-1">
            {isFieldOverridden('sound') && (
              <ResetToDefaultButton
                defaultLabel="on"
                onReset={() => resetField('sound')}
                disabled={loading}
              />
            )}
            <Switch
              checked={notifications?.sound ?? true}
              disabled={loading}
              onCheckedChange={(next) => update({ sound: next })}
            />
          </div>
        </div>

        {/* Sound timing */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">Sound timing</p>
            <p className="text-sm text-muted-foreground">When to play sounds.</p>
          </div>
          <div className="flex items-center gap-1">
            {isFieldOverridden('soundFocusMode') && (
              <ResetToDefaultButton
                defaultLabel="always"
                onReset={() => resetField('soundFocusMode')}
                disabled={loading}
              />
            )}
            <Select
              value={notifications?.soundFocusMode ?? 'always'}
              onValueChange={(next) => update({ soundFocusMode: next as 'always' | 'unfocused' })}
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
        </div>

        {/* OS notifications toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium text-foreground">OS notifications</p>
            <p className="text-sm text-muted-foreground">
              Show system banners when agents need attention or finish (while Emdash is unfocused).
            </p>
          </div>
          <div className="flex items-center gap-1">
            {isFieldOverridden('osNotifications') && (
              <ResetToDefaultButton
                defaultLabel="on"
                onReset={() => resetField('osNotifications')}
                disabled={loading}
              />
            )}
            <Switch
              checked={notifications?.osNotifications ?? true}
              disabled={loading}
              onCheckedChange={(next) => update({ osNotifications: next })}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationSettingsCard;

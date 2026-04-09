import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

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
      <SettingRow
        title="Notifications"
        description="Get notified when agents need your attention."
        control={
          <>
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
          </>
        }
      />
      <div
        className={cn(
          'flex flex-col gap-3',
          !notifications?.enabled && 'pointer-events-none opacity-33'
        )}
      >
        <SettingRow
          title="Sound"
          description="Play audio cues for agent events."
          control={
            <>
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
            </>
          }
        />

        <SettingRow
          title="Sound timing"
          description="When to play sounds."
          control={
            <>
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
            </>
          }
        />

        <SettingRow
          title="OS notifications"
          description="Show system banners when agents need attention or finish (while Emdash is unfocused)."
          control={
            <>
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
            </>
          }
        />
      </div>
    </div>
  );
};

export default NotificationSettingsCard;

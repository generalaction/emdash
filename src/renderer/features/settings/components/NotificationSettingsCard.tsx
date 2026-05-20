import { FolderOpen, Play } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { configureSoundPlayer, soundPlayer } from '@renderer/utils/soundPlayer';
import { cn } from '@renderer/utils/utils';
import type { NotificationSettings } from '@shared/app-settings';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const getFileName = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
};

function PreviewSoundButton({
  path,
  disabled,
}: {
  path: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              disabled={disabled}
              onClick={() => soundPlayer.preview(path)}
              aria-label="Preview sound"
            >
              <Play className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent side="top">Preview</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const NotificationSettingsCard: React.FC = () => {
  const {
    value: notifications,
    update,
    isLoading: loading,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('notifications');

  const currentNotifications: NotificationSettings = notifications ?? {
    enabled: true,
    sound: true,
    customSoundPath: '',
    osNotifications: true,
    soundFocusMode: 'always',
  };
  const customSoundPath = currentNotifications.customSoundPath?.trim() ?? '';

  const updateNotifications = (partial: Partial<NotificationSettings>) => {
    configureSoundPlayer({ ...currentNotifications, ...partial });
    update(partial);
  };

  const resetNotificationField = <K extends keyof NotificationSettings>(
    field: K,
    value: NotificationSettings[K]
  ) => {
    configureSoundPlayer({ ...currentNotifications, [field]: value });
    resetField(field);
  };

  const chooseCustomSound = async () => {
    const result = await rpc.app.openSelectAudioFileDialog({
      title: 'Choose custom sound',
      message: 'Select an audio file to play for agent events',
    });
    if (result) updateNotifications({ customSoundPath: result });
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Notifications"
        description="Get notified when agents need your attention."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('enabled')}
              defaultLabel="on"
              onReset={() => resetField('enabled')}
              disabled={loading}
            />
            <Switch
              checked={notifications?.enabled ?? true}
              disabled={loading}
              onCheckedChange={(next) => updateNotifications({ enabled: next })}
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
              <ResetToDefaultButton
                visible={isFieldOverridden('sound')}
                defaultLabel="on"
                onReset={() => resetNotificationField('sound', true)}
                disabled={loading}
              />
              {!customSoundPath && <PreviewSoundButton path="" disabled={loading} />}
              <Switch
                checked={notifications?.sound ?? true}
                disabled={loading}
                onCheckedChange={(next) => updateNotifications({ sound: next })}
              />
            </>
          }
        />

        <SettingRow
          title="Custom sound"
          description="Use an audio file instead of the built-in cue."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('customSoundPath')}
                defaultLabel="built-in"
                onReset={() => resetNotificationField('customSoundPath', '')}
                disabled={loading}
              />
              {customSoundPath && <PreviewSoundButton path={customSoundPath} disabled={loading} />}
              <TooltipProvider delay={150}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-muted-foreground max-w-56 font-normal"
                        disabled={loading}
                        onClick={chooseCustomSound}
                        aria-label={customSoundPath ? 'Change custom sound' : 'Choose custom sound'}
                      >
                        <FolderOpen className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {customSoundPath ? getFileName(customSoundPath) : 'Choose file…'}
                        </span>
                      </Button>
                    }
                  />
                  {customSoundPath && (
                    <TooltipContent side="top" className="break-all">
                      {customSoundPath}
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </>
          }
        />

        <SettingRow
          title="Sound timing"
          description="When to play sounds."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('soundFocusMode')}
                defaultLabel="always"
                onReset={() => resetNotificationField('soundFocusMode', 'always')}
                disabled={loading}
              />
              <Select
                value={notifications?.soundFocusMode ?? 'always'}
                onValueChange={(next) =>
                  updateNotifications({ soundFocusMode: next as 'always' | 'unfocused' })
                }
              >
                <SelectTrigger className="w-auto shrink-0 gap-2 capitalize [&>span]:line-clamp-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-max">
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
              <ResetToDefaultButton
                visible={isFieldOverridden('osNotifications')}
                defaultLabel="on"
                onReset={() => resetNotificationField('osNotifications', true)}
                disabled={loading}
              />
              <Switch
                checked={notifications?.osNotifications ?? true}
                disabled={loading}
                onCheckedChange={(next) => updateNotifications({ osNotifications: next })}
              />
            </>
          }
        />
      </div>
    </div>
  );
};

export default NotificationSettingsCard;

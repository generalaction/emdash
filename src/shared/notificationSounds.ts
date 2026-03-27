export const NOTIFICATION_SOUND_PROFILES = ['default', 'gilfoyle'] as const;

export type NotificationSoundProfile = (typeof NOTIFICATION_SOUND_PROFILES)[number];

export function isNotificationSoundProfile(value: unknown): value is NotificationSoundProfile {
  return (
    typeof value === 'string' &&
    NOTIFICATION_SOUND_PROFILES.includes(value as NotificationSoundProfile)
  );
}

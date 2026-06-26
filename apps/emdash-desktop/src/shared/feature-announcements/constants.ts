export const FEATURE_ANNOUNCEMENT_MANIFEST_FILENAME = 'feature-announcements.toml';

export const FEATURE_ANNOUNCEMENT_MANIFEST_URL =
  'https://raw.githubusercontent.com/generalaction/emdash/main/apps/emdash-desktop/feature-announcements.toml';

export const FEATURE_ANNOUNCEMENT_CTA_ACTIONS = ['open-automations'] as const;

export type FeatureAnnouncementCtaAction = (typeof FEATURE_ANNOUNCEMENT_CTA_ACTIONS)[number];

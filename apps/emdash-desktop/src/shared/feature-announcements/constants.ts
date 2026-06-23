export const FEATURE_ANNOUNCEMENT_MANIFEST_FILENAME = 'feature-announcements.toml';

export const FEATURE_ANNOUNCEMENT_MANIFEST_URL =
  'https://raw.githubusercontent.com/generalaction/emdash/main/apps/emdash-desktop/feature-announcements.toml';

export const FEATURE_ANNOUNCEMENT_DISMISSED_STORAGE_KEY = 'emdash:feature-announcements:dismissed';

export const FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS = [
  'home',
  'automations',
  'library',
  'skills',
  'mcp',
  'project',
  'task',
  'settings',
] as const;

export type FeatureAnnouncementNavigableView =
  (typeof FEATURE_ANNOUNCEMENT_NAVIGABLE_VIEWS)[number];

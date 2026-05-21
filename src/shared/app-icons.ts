export const APP_ICON_IDS = ['default', 'beta', 'canary'] as const;

export type AppIconId = (typeof APP_ICON_IDS)[number];

export const APP_ICON_LABELS = {
  default: 'Default',
  beta: 'Beta',
  canary: 'Canary',
} satisfies Record<AppIconId, string>;

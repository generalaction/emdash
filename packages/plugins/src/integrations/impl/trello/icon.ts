import type { PluginIconAsset } from '@emdash/shared/plugins';

export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'Trello',
  variants: [
    {
      minSize: 0,
      light: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="3" fill="#0079BF"/><rect x="3.5" y="3.5" width="7.5" height="13.5" rx="1.5" fill="#fff"/><rect x="13" y="3.5" width="7.5" height="9" rx="1.5" fill="#fff"/></svg>`,
    },
  ],
};

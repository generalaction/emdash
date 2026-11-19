import type { PluginIconAsset } from '@emdash/shared/plugins';

// Generic terminal symbol, not upstream brand artwork.
export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'OmO Native',
  variants: [
    {
      minSize: 0,
      light:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="17" rx="3"/><path d="m6 8 4 4-4 4m7 0h5"/></svg>',
    },
  ],
};

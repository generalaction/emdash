import type { PluginIconAsset } from '@emdash/shared/plugins';

export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'OmO Native',
  variants: [
    {
      minSize: 0,
      light:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="8" cy="16" r="4"/><path d="M13 21V11l3 5 3-5v10"/><circle cx="25" cy="16" r="4"/></svg>',
    },
  ],
};

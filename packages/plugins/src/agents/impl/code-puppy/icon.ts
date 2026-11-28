import type { PluginIconAsset } from '@emdash/shared/plugins';

// A "CP" monogram in the block lettering and colours of Code Puppy's `code_puppy.png` banner.
export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'Code Puppy',
  variants: [
    {
      minSize: 0,
      light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>Code Puppy</title><rect width="32" height="32" rx="6" fill="#15191e"/><g fill="#a8abec"><rect x="4.3" y="6.25" width="10.8" height="3.9"/><rect x="2.5" y="10.15" width="3.6" height="3.9"/><rect x="16.9" y="6.25" width="10.8" height="3.9"/><rect x="16.9" y="10.15" width="3.6" height="3.9"/><rect x="25.9" y="10.15" width="3.6" height="3.9"/></g><g fill="#8efafd"><rect x="2.5" y="14.05" width="3.6" height="3.9"/><rect x="2.5" y="17.95" width="3.6" height="3.9"/><rect x="16.9" y="14.05" width="10.8" height="3.9"/><rect x="16.9" y="17.95" width="3.6" height="3.9"/></g><g fill="#82e398"><rect x="4.3" y="21.85" width="10.8" height="3.9"/><rect x="16.9" y="21.85" width="3.6" height="3.9"/></g></svg>`,
    },
  ],
};

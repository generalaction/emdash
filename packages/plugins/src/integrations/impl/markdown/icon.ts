import type { PluginIconAsset } from '@emdash/shared/plugins';

export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'Repository tasks',
  variants: [
    {
      minSize: 0,
      light: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6 2h7.17a2 2 0 0 1 1.42.59l4.82 4.82A2 2 0 0 1 20 8.83V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 2H6v16h12V9h-4a1 1 0 0 1-1-1zm2 1.41V7h1.59zM7.5 11.5h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1 0-1.5m0 3.5h9a.75.75 0 0 1 0 1.5h-9a.75.75 0 0 1 0-1.5"/></svg>`,
    },
  ],
};

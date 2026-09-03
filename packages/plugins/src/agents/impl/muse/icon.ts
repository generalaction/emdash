import type { PluginIconAsset } from '@emdash/shared/plugins';

export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'Muse Code CLI',
  variants: [
    {
      minSize: 0,
      light: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0082FB"/><text x="32" y="46" font-family="ui-monospace, Menlo, monospace" font-size="38" font-weight="800" text-anchor="middle" fill="#ffffff">M</text></svg>`,
    },
  ],
};

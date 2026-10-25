import type { PluginIconAsset } from '@emdash/shared/plugins';

export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'Codewhale',
  variants: [
    {
      minSize: 0,
      light: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
  <path d="M2 9.5c0-3.3 2.7-6 6-6h4.5v2H8a4 4 0 0 0-4 4v.5h7.5a2.5 2.5 0 0 0 2.4-1.8l.6-2.2H16l-.7 2.7A4 4 0 0 1 11.5 12H4.2A3 3 0 0 1 2 9.5Z" fill="#18181b"/>
  <path d="M5 7h1.5v1.5H5V7Zm3 0h1.5v1.5H8V7Z" fill="#18181b"/>
</svg>`,
      dark: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
  <path d="M2 9.5c0-3.3 2.7-6 6-6h4.5v2H8a4 4 0 0 0-4 4v.5h7.5a2.5 2.5 0 0 0 2.4-1.8l.6-2.2H16l-.7 2.7A4 4 0 0 1 11.5 12H4.2A3 3 0 0 1 2 9.5Z" fill="#fafafa"/>
  <path d="M5 7h1.5v1.5H5V7Zm3 0h1.5v1.5H8V7Z" fill="#fafafa"/>
</svg>`,
    },
  ],
};

import type { StorybookConfig } from '@storybook/react-vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  // vanillaExtractPlugin must come before tailwindcss so VE extracts .css.ts
  // before Tailwind scans output. Both coexist during the migration.
  viteFinal: (config) => mergeConfig(config, { plugins: [vanillaExtractPlugin(), tailwindcss()] }),
};

export default config;

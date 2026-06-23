import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import type { StorybookConfig } from 'storybook-solidjs-vite';
import { mergeConfig } from 'vite';
import solid from 'vite-plugin-solid';

const config: StorybookConfig = {
  stories: ['../src/solid/**/*.mdx', '../src/solid/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: 'storybook-solidjs-vite',
    options: {},
  },
  viteFinal: (config) =>
    mergeConfig(config, {
      plugins: [solid(), vanillaExtractPlugin()],
    }),
};

export default config;

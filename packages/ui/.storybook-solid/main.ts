import type { StorybookConfig } from 'storybook-solidjs-vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import solid from 'vite-plugin-solid';
import { mergeConfig } from 'vite';

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

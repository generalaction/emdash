import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import type { StorybookConfig } from 'storybook-solidjs-vite';
import { mergeConfig } from 'vite';

const dir = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: 'storybook-solidjs-vite',
  viteFinal: (config) =>
    mergeConfig(config, {
      plugins: [vanillaExtractPlugin()],
      resolve: {
        alias: {
          '@components': resolve(dir, '../src/components'),
          '@core': resolve(dir, '../src/core'),
          '@lib': resolve(dir, '../src/lib'),
          '@state': resolve(dir, '../src/state'),
          '@styles': resolve(dir, '../src/styles'),
          '@': resolve(dir, '../src'),
        },
      },
    }),
};

export default config;

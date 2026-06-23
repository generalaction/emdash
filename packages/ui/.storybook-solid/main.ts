import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import type { StorybookConfig } from 'storybook-solidjs-vite';
import { mergeConfig } from 'vite';
import solid from 'vite-plugin-solid';

const root = resolve(__dirname, '../src');

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
      resolve: {
        alias: {
          '@': root,
          '@react': resolve(root, 'react'),
          '@solid': resolve(root, 'solid'),
          '@styles': resolve(root, 'styles'),
          '@theme': resolve(root, 'theme'),
        },
      },
    }),
};

export default config;

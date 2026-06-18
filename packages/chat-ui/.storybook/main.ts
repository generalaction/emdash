import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from 'storybook-solidjs-vite';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: 'storybook-solidjs-vite',
  viteFinal: (config) => mergeConfig(config, { plugins: [tailwindcss()] }),
};

export default config;

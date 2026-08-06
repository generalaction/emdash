// Uses vite's defineConfig (not vitest/config) so the vanilla-extract plugin
// type matches the workspace vite version; no test-specific options are set.
import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';

const root = resolve(__dirname, 'src');

// Mirrors the resolve aliases from vite.lib.config.ts so component tests can
// import modules that use @/, @styles, and @theme paths. The vanilla-extract
// plugin is required to evaluate .css.ts files outside the lib build.
export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      '@react': resolve(root, 'react'),
      '@styles': resolve(root, 'styles'),
      '@theme': resolve(root, 'theme'),
    },
  },
  plugins: [vanillaExtractPlugin()],
});

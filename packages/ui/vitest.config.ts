import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
// vite's defineConfig (not vitest/config's) so the vanilla-extract plugin
// types resolve against the same vite version; no `test` options are needed.
import { defineConfig } from 'vite';
import type { PluginOption } from 'vite';

const root = resolve(__dirname, 'src');

// Mirrors the source aliases used by the Rollup library build so tests can
// compile components and their .css.ts modules directly.
export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      '@react': resolve(root, 'react'),
      '@styles': resolve(root, 'styles'),
    },
  },
  plugins: [vanillaExtractPlugin() as unknown as PluginOption],
});

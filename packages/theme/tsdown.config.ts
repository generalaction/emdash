import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/core/index.ts',
    profiles: 'src/profiles.ts',
    runtime: 'src/runtime.ts',
    'shiki-themes': 'src/__generated__/shiki-themes.gen.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['colorjs.io'],
  },
  sourcemap: true,
  clean: true,
});

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    live: 'src/live/index.ts',
    api: 'src/api/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['@emdash/shared', 'immer', 'zod'],
  },
  sourcemap: true,
  clean: true,
});

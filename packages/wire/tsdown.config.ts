import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    live: 'src/live/index.ts',
    api: 'src/api/index.ts',
    util: 'src/util/index.ts',
    optimistic: 'src/util/optimistic/index.ts',
    process: 'src/process/index.ts',
    'process-node': 'src/process/node/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['@emdash/shared', 'immer', 'mobx', 'zod'],
  },
  sourcemap: true,
  clean: true,
});

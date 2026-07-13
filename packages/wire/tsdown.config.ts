import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    live: 'src/live/index.ts',
    api: 'src/api/index.ts',
    observability: 'src/observability/index.ts',
    testing: 'src/testing/index.ts',
    util: 'src/util/index.ts',
    mobx: 'src/util/mobx/index.ts',
    worker: 'src/worker/index.ts',
    'worker-node': 'src/worker/node/index.ts',
    'worker-electron': 'src/worker/electron/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['@emdash/shared', 'immer', 'mobx', 'zod'],
  },
  sourcemap: true,
  clean: true,
});

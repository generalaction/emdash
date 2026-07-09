import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'acp-runtime': 'src/acp/runtime-entry.ts',
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: ['node-pty', 'zod'],
  },
});

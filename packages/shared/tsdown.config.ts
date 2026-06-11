import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    deps: 'src/deps/index.ts',
    'deps-runtime': 'src/deps/runtime.ts',
    exec: 'src/exec/index.ts',
    fs: 'src/fs/index.ts',
    git: 'src/git/index.ts',
    lib: 'src/lib/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['zod', '@parcel/watcher', '@emdash/cli-agent-plugins'],
  },
  sourcemap: true,
  clean: true,
});

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    deps: 'src/deps/runtime/index.ts',
    'deps-runtime': 'src/deps/runtime/runtime.ts',
    exec: 'src/exec/index.ts',
    fs: 'src/fs/index.ts',
    git: 'src/git/index.ts',
    lib: 'src/lib/index.ts',
    'agents-plugins': 'src/agents/plugins/index.ts',
    'agents-plugins-helpers': 'src/agents/plugins/helpers/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['zod', '@parcel/watcher', 'react', 'smol-toml'],
  },
  sourcemap: true,
  clean: true,
});

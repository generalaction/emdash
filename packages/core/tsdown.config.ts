import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    acp: 'src/acp/index.ts',
    'acp-session-machine': 'src/acp/session-machine.ts',
    'acp-transcript-parser': 'src/acp/acp-transcript-parser/index.ts',
    deps: 'src/host-dependencies/capability.ts',
    'deps-runtime': 'src/host-dependencies/runtime/index.ts',
    exec: 'src/exec/index.ts',
    files: 'src/files/index.ts',
    watch: 'src/watch/index.ts',
    git: 'src/git/index.ts',
    lib: 'src/lib/index.ts',
    'agents-plugins': 'src/agents/plugins/index.ts',
    'agents-plugins-helpers': 'src/agents/plugins/helpers/index.ts',
    'live-model': 'src/live-model/index.ts',
    'workspace-server': 'src/workspace-server/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['zod', '@parcel/watcher', 'react', 'smol-toml', 'semver'],
  },
  sourcemap: true,
  clean: true,
});

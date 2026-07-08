import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    acp: 'src/acp/index.ts',
    'acp-client': 'src/acp/client.ts',
    'acp-transcript-parser': 'src/acp/reducer/index.ts',
    deps: 'src/host-dependencies/capability.ts',
    'deps-runtime': 'src/host-dependencies/runtime/index.ts',
    exec: 'src/exec/index.ts',
    files: 'src/files/index.ts',
    watch: 'src/watch/index.ts',
    git: 'src/git/index.ts',
    lib: 'src/lib/index.ts',
    'agents-plugins': 'src/agents/plugins/index.ts',
    'agents-plugins-helpers': 'src/agents/plugins/helpers/index.ts',
    live: 'src/live/index.ts',
    wire: 'src/wire/index.ts',
    'workspace-server': 'src/workspace-server/index.ts',
    'workspace-bootstrap': 'src/workspace-bootstrap/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['@emdash/wire', 'zod', '@parcel/watcher', 'react', 'smol-toml', 'semver'],
  },
  sourcemap: true,
  clean: true,
});

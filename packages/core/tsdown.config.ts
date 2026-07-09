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
    pty: 'src/pty/index.ts',
    'pty-node': 'src/pty/node/index.ts',
    'agents-plugins': 'src/agents/plugins/index.ts',
    'agents-plugins-helpers': 'src/agents/plugins/helpers/index.ts',
    'workspace-server': 'src/workspace-server/index.ts',
    'workspace-lifecycle': 'src/workspace-lifecycle/index.ts',
    'workspace-activity': 'src/workspace-activity/index.ts',
    'workspace-coordinator': 'src/workspace-coordinator/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: [
      '@emdash/wire',
      'zod',
      '@parcel/watcher',
      'react',
      'smol-toml',
      'semver',
      'node-pty',
    ],
  },
  sourcemap: true,
  clean: true,
});

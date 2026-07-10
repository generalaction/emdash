import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    acp: 'src/acp/index.ts',
    'acp-node': 'src/acp/node/index.ts',
    git: 'src/git/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: [
      '@agentclientprotocol/sdk',
      '@emdash/core',
      '@emdash/shared',
      '@emdash/wire',
      'node-pty',
      'zod',
    ],
  },
  sourcemap: true,
  clean: true,
});

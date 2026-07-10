import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'acp-agents': 'src/acp-agents/index.ts',
    'acp-agents-node': 'src/acp-agents/node/index.ts',
    'tui-agents': 'src/tui-agents/index.ts',
    'tui-agents-node': 'src/tui-agents/node/index.ts',
    'agent-config': 'src/agent-config/index.ts',
    'agent-config-node': 'src/agent-config/node/index.ts',
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

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    acp: 'src/acp/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: [
      '@agentclientprotocol/sdk',
      '@emdash/core',
      '@emdash/shared',
      '@emdash/wire',
      'zod',
    ],
  },
  sourcemap: true,
  clean: true,
});

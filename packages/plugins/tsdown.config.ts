import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    agents: 'src/agents/registry.ts',
    integrations: 'src/integrations/index.ts',
    issues: 'src/issues/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['zod', 'smol-toml', '@emdash/core', '@emdash/shared'],
  },
  sourcemap: true,
  clean: true,
});

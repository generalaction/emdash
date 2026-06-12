import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    agents: 'src/agents/registry.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['zod', 'smol-toml', '@emdash/shared'],
  },
  sourcemap: true,
  clean: true,
});

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/agents/index.ts',
    definitions: 'src/agents/definitions.ts',
    providers: 'src/agents/providers.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['zod', 'smol-toml', '@emdash/shared'],
  },
  sourcemap: true,
  clean: true,
});

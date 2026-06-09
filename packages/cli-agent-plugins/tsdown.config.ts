import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'index.ts',
    metadata: 'metadata.ts',
    icons: 'icons.ts',
    providers: 'providers.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['react', 'zod', 'smol-toml'],
  },
  sourcemap: true,
  clean: true,
});

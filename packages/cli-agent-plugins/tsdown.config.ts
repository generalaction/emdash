import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    metadata: 'src/metadata.ts',
    icons: 'src/icons.ts',
    providers: 'src/providers.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['react', 'zod', 'smol-toml'],
  },
  sourcemap: true,
  clean: true,
});

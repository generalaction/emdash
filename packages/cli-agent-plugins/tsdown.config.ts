import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'index.ts',
    impl: 'impl/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  deps: {
    neverBundle: ['react', 'zod', 'smol-toml'],
  },
  sourcemap: true,
  clean: true,
});

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', result: 'src/result/index.ts' },
  format: ['esm'],
  dts: true,
  deps: {},
  sourcemap: true,
  clean: true,
});

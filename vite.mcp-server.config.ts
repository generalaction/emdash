import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'out/mcp-server',
    emptyOutDir: true,
    target: 'node20',
    ssr: true,
    minify: false,
    lib: {
      entry: resolve('src/mcp-server/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});

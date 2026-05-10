import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Standalone build for the emdash-mcp subprocess. Output: out/mcp-server/index.cjs
 *
 * Bundled to a single CJS file so it can be invoked as `node out/mcp-server/index.cjs`
 * (or shipped inside the Electron resources dir at package time). MCP SDK + zod are
 * bundled; native node modules are externalised.
 */
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
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
    },
  },
});

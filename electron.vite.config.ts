import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    root: 'src/main',
    envDir: resolve('.'),
    resolve: {
      alias: {
        '@': resolve('src'),
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
    // Build the standalone `emdash-mcp` stdio bridge alongside the main
    // process. External MCP clients (Claude Code, Cursor, Codex) spawn this
    // bin and it proxies stdio ↔ the in-process HTTP MCP server (see
    // `bin/emdash-mcp.ts` and the spec
    // `docs/superpowers/specs/2026-05-16-mcp-server-design.md`).
    //
    // The output ends up at `out/main/emdash-mcp.js` and is shipped as an
    // extraResource by `electron-builder.config.ts`.
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'emdash-mcp': resolve('bin/emdash-mcp.ts'),
        },
      },
    },
  },
  preload: {
    root: 'src/preload',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src'),
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
    server: {
      port: 3000,
    },
  },
});

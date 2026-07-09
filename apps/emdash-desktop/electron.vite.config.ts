import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const workspaceAliases = {
  '@emdash/core/acp/client': resolve('../../packages/core/src/acp/client.ts'),
  '@emdash/core/acp': resolve('../../packages/core/src/acp/index.ts'),
  '@emdash/core/agents/plugins/helpers': resolve(
    '../../packages/core/src/agents/plugins/helpers/index.ts'
  ),
  '@emdash/core/agents/plugins': resolve('../../packages/core/src/agents/plugins/index.ts'),
  '@emdash/plugins/agents/types': resolve('../../packages/plugins/src/agents/types.ts'),
  '@emdash/plugins/agents': resolve('../../packages/plugins/src/agents/registry.ts'),
  '@emdash/wire/api': resolve('../../packages/wire/src/api/index.ts'),
  '@emdash/wire/process': resolve('../../packages/wire/src/process/index.ts'),
  '@emdash/wire/util/mobx': resolve('../../packages/wire/src/util/mobx/index.ts'),
  '@emdash/wire/util/process-runtime': resolve(
    '../../packages/wire/src/util/process-runtime/index.ts'
  ),
  '@emdash/wire': resolve('../../packages/wire/src/index.ts'),
};

export default defineConfig({
  main: {
    root: 'src/main',
    envDir: resolve('.'),
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'acp-runtime': resolve('src/main/core/acp/runtime-process/entry.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve('src'),
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
        ...workspaceAliases,
      },
    },
  },
  preload: {
    root: 'src/preload',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
        ...workspaceAliases,
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
        ...workspaceAliases,
        // cli-agent-plugins metadata/icons chunks transitively reference node:buffer
        // (through hook-config helpers bundled in the same tsdown chunk), even though
        // those helpers never run in the renderer. Alias to the browser-safe polyfill.
        'node:buffer': 'buffer',
      },
    },
    server: {
      port: 3000,
    },
  },
});

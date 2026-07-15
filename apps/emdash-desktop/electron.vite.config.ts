import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { desktopWorkerBuildInputs } from './src/main/worker-manifest';

const workspaceAliases = {
  '@emdash/core/runtimes': resolve('../../packages/core/src/runtimes'),
  '@emdash/core/services': resolve('../../packages/core/src/services'),
  '@emdash/core/primitives': resolve('../../packages/core/src/primitives'),
  '@emdash/core/workspace-server': resolve('../../packages/core/src/workspace-server'),
  '@services/notifications': resolve('src/services/notifications'),
  '@runtimes': resolve('../../packages/core/src/runtimes'),
  '@services': resolve('../../packages/core/src/services'),
  '@primitives': resolve('../../packages/core/src/primitives'),
  '@workspace-server': resolve('../../packages/core/src/workspace-server'),
  '@emdash/core/services/fs-watch/api': resolve(
    '../../packages/core/src/services/fs-watch/api/index.ts'
  ),
  '@emdash/core/services/fs-watch/node': resolve(
    '../../packages/core/src/services/fs-watch/node/index.ts'
  ),
  '@emdash/plugins/agents/types': resolve('../../packages/plugins/src/agents/types.ts'),
  '@emdash/plugins/agents': resolve('../../packages/plugins/src/agents/registry.ts'),
  '@emdash/shared/config': resolve('../../packages/shared/src/config/index.ts'),
  '@emdash/shared/logger/context-node': resolve('../../packages/shared/src/logger/context-node.ts'),
  '@emdash/shared/logger/context': resolve('../../packages/shared/src/logger/context.ts'),
  '@emdash/shared/logger/node': resolve('../../packages/shared/src/logger/node/index.ts'),
  '@emdash/shared/logger/pino': resolve('../../packages/shared/src/logger/pino/index.ts'),
  '@emdash/shared/logger/transport': resolve('../../packages/shared/src/logger/transport/index.ts'),
  '@emdash/shared/logger': resolve('../../packages/shared/src/logger/index.ts'),
  '@emdash/shared/markdown': resolve('../../packages/shared/src/markdown/index.ts'),
  '@emdash/shared/plugins': resolve('../../packages/shared/src/plugins/index.ts'),
  '@emdash/shared/result': resolve('../../packages/shared/src/result/index.ts'),
  '@emdash/shared/scheduling': resolve('../../packages/shared/src/scheduling/index.ts'),
  '@emdash/shared/concurrency': resolve('../../packages/shared/src/concurrency/index.ts'),
  '@emdash/shared/util': resolve('../../packages/shared/src/util/index.ts'),
  '@emdash/shared/testing': resolve('../../packages/shared/src/testing/index.ts'),
  '@emdash/shared': resolve('../../packages/shared/src/index.ts'),
  '@emdash/wire/api': resolve('../../packages/wire/src/api/index.ts'),
  '@emdash/wire/testing': resolve('../../packages/wire/src/testing/index.ts'),
  '@emdash/wire/util/mobx': resolve('../../packages/wire/src/util/mobx/index.ts'),
  '@emdash/wire/util': resolve('../../packages/wire/src/util/index.ts'),
  '@emdash/wire/worker/electron': resolve('../../packages/wire/src/worker/electron/index.ts'),
  '@emdash/wire/worker/node': resolve('../../packages/wire/src/worker/node/index.ts'),
  '@emdash/wire/worker': resolve('../../packages/wire/src/worker/index.ts'),
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
          ...desktopWorkerBuildInputs(),
        },
        output: {
          entryFileNames: '[name].js',
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

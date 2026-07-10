import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const workspaceAliases = {
  '@emdash/core/acp/client': resolve('../../packages/core/src/acp/client.ts'),
  '@emdash/core/acp': resolve('../../packages/core/src/acp/index.ts'),
  '@emdash/core/agents/agent-env': resolve('../../packages/core/src/agents/agent-env.ts'),
  '@emdash/core/agents/spawn-context': resolve('../../packages/core/src/agents/spawn-context.ts'),
  '@emdash/core/agents/plugins/helpers': resolve(
    '../../packages/core/src/agents/plugins/helpers/index.ts'
  ),
  '@emdash/core/agents/plugins': resolve('../../packages/core/src/agents/plugins/index.ts'),
  '@emdash/core/lib': resolve('../../packages/core/src/lib/index.ts'),
  '@emdash/core/mcp': resolve('../../packages/core/src/mcp/index.ts'),
  '@emdash/core/skills': resolve('../../packages/core/src/skills/index.ts'),
  '@emdash/core/workspace-server/agent-config': resolve(
    '../../packages/core/src/workspace-server/agent-config/index.ts'
  ),
  '@emdash/core/workspace-server': resolve('../../packages/core/src/workspace-server/index.ts'),
  '@emdash/core/deps/runtime': resolve(
    '../../packages/core/src/host-dependencies/runtime/index.ts'
  ),
  '@emdash/core/exec': resolve('../../packages/core/src/exec/index.ts'),
  '@emdash/core/pty/node': resolve('../../packages/core/src/pty/node/index.ts'),
  '@emdash/core/pty': resolve('../../packages/core/src/pty/index.ts'),
  '@emdash/plugins/agents/types': resolve('../../packages/plugins/src/agents/types.ts'),
  '@emdash/plugins/agents': resolve('../../packages/plugins/src/agents/registry.ts'),
  '@emdash/runtime/agent-config/node': resolve(
    '../../packages/runtime/src/agent-config/node/index.ts'
  ),
  '@emdash/runtime/agent-config': resolve('../../packages/runtime/src/agent-config/index.ts'),
  '@emdash/runtime/acp-agents/node': resolve('../../packages/runtime/src/acp-agents/node/index.ts'),
  '@emdash/runtime/acp-agents': resolve('../../packages/runtime/src/acp-agents/index.ts'),
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
  '@emdash/shared': resolve('../../packages/shared/src/index.ts'),
  '@emdash/wire/api': resolve('../../packages/wire/src/api/index.ts'),
  '@emdash/wire/process/node': resolve('../../packages/wire/src/process/node/index.ts'),
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
          'agent-config-runtime': resolve('src/main/core/agent-config/runtime-process/entry.ts'),
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

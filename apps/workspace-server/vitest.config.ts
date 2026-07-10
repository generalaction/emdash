import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@emdash/core/acp': resolve(__dirname, '../../packages/core/src/acp/index.ts'),
      '@emdash/core/agents/plugins/helpers': resolve(
        __dirname,
        '../../packages/core/src/agents/plugins/helpers/index.ts'
      ),
      '@emdash/core/agents/plugins': resolve(
        __dirname,
        '../../packages/core/src/agents/plugins/index.ts'
      ),
      '@emdash/core/agents/spawn-context': resolve(
        __dirname,
        '../../packages/core/src/agents/spawn-context.ts'
      ),
      '@emdash/core/deps/runtime': resolve(
        __dirname,
        '../../packages/core/src/host-dependencies/runtime/index.ts'
      ),
      '@emdash/core/pty/node': resolve(__dirname, '../../packages/core/src/pty/node/index.ts'),
      '@emdash/core/pty': resolve(__dirname, '../../packages/core/src/pty/index.ts'),
      '@emdash/core/workspace-server': resolve(
        __dirname,
        '../../packages/core/src/workspace-server/index.ts'
      ),
      '@emdash/plugins/agents': resolve(__dirname, '../../packages/plugins/src/agents/registry.ts'),
      '@emdash/plugins/agents/types': resolve(
        __dirname,
        '../../packages/plugins/src/agents/types.ts'
      ),
      '@emdash/runtime/acp-agents/node': resolve(
        __dirname,
        '../../packages/runtime/src/acp-agents/node/index.ts'
      ),
      '@emdash/runtime/acp-agents': resolve(
        __dirname,
        '../../packages/runtime/src/acp-agents/index.ts'
      ),
      '@emdash/shared/config': resolve(__dirname, '../../packages/shared/src/config/index.ts'),
      '@emdash/shared/logger/node': resolve(
        __dirname,
        '../../packages/shared/src/logger/node/index.ts'
      ),
      '@emdash/shared/logger': resolve(__dirname, '../../packages/shared/src/logger/index.ts'),
      '@emdash/shared/plugins': resolve(__dirname, '../../packages/shared/src/plugins/index.ts'),
      '@emdash/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@emdash/wire/api': resolve(__dirname, '../../packages/wire/src/api/index.ts'),
      '@emdash/wire/process/node': resolve(
        __dirname,
        '../../packages/wire/src/process/node/index.ts'
      ),
      '@emdash/wire/process': resolve(__dirname, '../../packages/wire/src/process/index.ts'),
      '@emdash/wire/util/process-runtime': resolve(
        __dirname,
        '../../packages/wire/src/util/process-runtime/index.ts'
      ),
      '@emdash/wire/util': resolve(__dirname, '../../packages/wire/src/util/index.ts'),
      '@emdash/wire': resolve(__dirname, '../../packages/wire/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@emdash/core/acp': resolve(__dirname, '../core/src/acp/index.ts'),
      '@emdash/core/workspace-server': resolve(__dirname, '../core/src/workspace-server/index.ts'),
      '@emdash/core/agents/agent-env': resolve(__dirname, '../core/src/agents/agent-env.ts'),
      '@emdash/core/agents/spawn-context': resolve(
        __dirname,
        '../core/src/agents/spawn-context.ts'
      ),
      '@emdash/core/agents/plugins/helpers': resolve(
        __dirname,
        '../core/src/agents/plugins/helpers/index.ts'
      ),
      '@emdash/core/agents/plugins': resolve(__dirname, '../core/src/agents/plugins/index.ts'),
      '@emdash/core/deps/runtime': resolve(
        __dirname,
        '../core/src/host-dependencies/runtime/index.ts'
      ),
      '@emdash/core/exec': resolve(__dirname, '../core/src/exec/index.ts'),
      '@emdash/core/files': resolve(__dirname, '../core/src/files/index.ts'),
      '@emdash/core/git': resolve(__dirname, '../core/src/git/index.ts'),
      '@emdash/core/lib': resolve(__dirname, '../core/src/lib/index.ts'),
      '@emdash/core/mcp': resolve(__dirname, '../core/src/mcp/index.ts'),
      '@emdash/core/pty/node': resolve(__dirname, '../core/src/pty/node/index.ts'),
      '@emdash/core/pty': resolve(__dirname, '../core/src/pty/index.ts'),
      '@emdash/core/services/fs-watch/api': resolve(
        __dirname,
        '../core/src/services/fs-watch/api/index.ts'
      ),
      '@emdash/core/services/fs-watch/node': resolve(
        __dirname,
        '../core/src/services/fs-watch/node/index.ts'
      ),
      '@emdash/core/skills': resolve(__dirname, '../core/src/skills/index.ts'),
      '@emdash/shared/logger/node': resolve(__dirname, '../shared/src/logger/node/index.ts'),
      '@emdash/shared/logger': resolve(__dirname, '../shared/src/logger/index.ts'),
      '@emdash/shared/plugins': resolve(__dirname, '../shared/src/plugins/index.ts'),
      '@emdash/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@emdash/wire/api': resolve(__dirname, '../wire/src/api/index.ts'),
      '@emdash/wire/testing': resolve(__dirname, '../wire/src/testing/index.ts'),
      '@emdash/wire/util': resolve(__dirname, '../wire/src/util/index.ts'),
      '@emdash/wire/worker': resolve(__dirname, '../wire/src/worker/index.ts'),
      '@emdash/wire': resolve(__dirname, '../wire/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});

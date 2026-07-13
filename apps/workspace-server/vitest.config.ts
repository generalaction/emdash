import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@emdash/core/runtimes': resolve(__dirname, '../../packages/core/src/runtimes'),
      '@emdash/core/services': resolve(__dirname, '../../packages/core/src/services'),
      '@emdash/core/primitives': resolve(__dirname, '../../packages/core/src/primitives'),
      '@emdash/core/workspace-server': resolve(
        __dirname,
        '../../packages/core/src/workspace-server/index.ts'
      ),
      '@runtimes': resolve(__dirname, '../../packages/core/src/runtimes'),
      '@services': resolve(__dirname, '../../packages/core/src/services'),
      '@primitives': resolve(__dirname, '../../packages/core/src/primitives'),
      '@workspace-server': resolve(__dirname, '../../packages/core/src/workspace-server'),
      '@emdash/plugins/agents': resolve(__dirname, '../../packages/plugins/src/agents/registry.ts'),
      '@emdash/plugins/agents/types': resolve(
        __dirname,
        '../../packages/plugins/src/agents/types.ts'
      ),
      '@emdash/shared/config': resolve(__dirname, '../../packages/shared/src/config/index.ts'),
      '@emdash/shared/logger/node': resolve(
        __dirname,
        '../../packages/shared/src/logger/node/index.ts'
      ),
      '@emdash/shared/logger': resolve(__dirname, '../../packages/shared/src/logger/index.ts'),
      '@emdash/shared/plugins': resolve(__dirname, '../../packages/shared/src/plugins/index.ts'),
      '@emdash/shared/scheduling': resolve(
        __dirname,
        '../../packages/shared/src/scheduling/index.ts'
      ),
      '@emdash/shared/concurrency': resolve(
        __dirname,
        '../../packages/shared/src/concurrency/index.ts'
      ),
      '@emdash/shared/util': resolve(__dirname, '../../packages/shared/src/util/index.ts'),
      '@emdash/shared/testing': resolve(__dirname, '../../packages/shared/src/testing/index.ts'),
      '@emdash/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@emdash/wire/api': resolve(__dirname, '../../packages/wire/src/api/index.ts'),
      '@emdash/wire/util': resolve(__dirname, '../../packages/wire/src/util/index.ts'),
      '@emdash/wire/worker/node': resolve(
        __dirname,
        '../../packages/wire/src/worker/node/index.ts'
      ),
      '@emdash/wire/worker': resolve(__dirname, '../../packages/wire/src/worker/index.ts'),
      '@emdash/wire': resolve(__dirname, '../../packages/wire/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});

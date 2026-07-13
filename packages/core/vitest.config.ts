import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@runtimes': resolve(__dirname, 'src/runtimes'),
      '@services': resolve(__dirname, 'src/services'),
      '@primitives': resolve(__dirname, 'src/primitives'),
      '@workspace-server': resolve(__dirname, 'src/workspace-server'),
      '@emdash/wire/api': resolve(__dirname, '../wire/src/api/index.ts'),
      '@emdash/wire/scheduling': resolve(__dirname, '../wire/src/scheduling/index.ts'),
      '@emdash/wire/testing': resolve(__dirname, '../wire/src/testing/index.ts'),
      '@emdash/wire/util': resolve(__dirname, '../wire/src/util/index.ts'),
      '@emdash/wire/worker/node': resolve(__dirname, '../wire/src/worker/node/index.ts'),
      '@emdash/wire/worker': resolve(__dirname, '../wire/src/worker/index.ts'),
      '@emdash/wire': resolve(__dirname, '../wire/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
});

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@emdash/wire/api': resolve(__dirname, '../wire/src/api/index.ts'),
      '@emdash/wire/process': resolve(__dirname, '../wire/src/process/index.ts'),
      '@emdash/wire/testing': resolve(__dirname, '../wire/src/testing/index.ts'),
      '@emdash/wire/util/process-runtime': resolve(
        __dirname,
        '../wire/src/util/process-runtime/index.ts'
      ),
      '@emdash/wire/util': resolve(__dirname, '../wire/src/util/index.ts'),
      '@emdash/wire/worker': resolve(__dirname, '../wire/src/worker/index.ts'),
      '@emdash/wire': resolve(__dirname, '../wire/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
});

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@emdash/core/acp': resolve(__dirname, '../core/src/acp/index.ts'),
      '@emdash/core/agents/plugins': resolve(__dirname, '../core/src/agents/plugins/index.ts'),
      '@emdash/core/lib': resolve(__dirname, '../core/src/lib/index.ts'),
      '@emdash/core/pty/node': resolve(__dirname, '../core/src/pty/node/index.ts'),
      '@emdash/core/pty': resolve(__dirname, '../core/src/pty/index.ts'),
      '@emdash/shared/logger': resolve(__dirname, '../shared/src/logger/index.ts'),
      '@emdash/shared/plugins': resolve(__dirname, '../shared/src/plugins/index.ts'),
      '@emdash/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@emdash/wire': resolve(__dirname, '../wire/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
});

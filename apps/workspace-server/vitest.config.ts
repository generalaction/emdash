import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [resolve(__dirname, '../../tooling/vitest/setup-isolated-home.mjs')],
    include: ['**/*.test.ts'],
  },
});

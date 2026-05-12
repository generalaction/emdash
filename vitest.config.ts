import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': resolve(__dirname, 'src'),
  '@root': resolve(__dirname, '.'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@main': resolve(__dirname, 'src/main'),
  '@tooling': resolve(__dirname, 'tooling'),
};

// For fixture and migration Vitest projects, redirect better-sqlite3 to an
// isolated copy installed under tooling/node-deps/ (compiled for system Node).
// The root node_modules/better-sqlite3 stays Electron-compiled at all times,
// so no rebuild dance is needed when switching between app dev and DB tests.
const toolingAlias = {
  ...alias,
  'better-sqlite3': resolve(__dirname, 'tooling/node-deps/node_modules/better-sqlite3'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        // All existing tests that run in a Node.js environment.
        // Migration tests are excluded — run them via `pnpm run test:migrations`.
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: [
            '**/_*/**',
            'src/renderer/tests/browser/**',
            'src/main/db/__tests__/migrations/**',
          ],
        },
      },
      {
        // Fixture generator — run explicitly via `pnpm run db:fixtures`.
        // Uses toolingAlias to load the system-Node build of better-sqlite3.
        extends: true,
        resolve: { alias: toolingAlias },
        test: {
          name: 'fixtures',
          environment: 'node',
          include: ['tooling/generate-fixtures.ts'],
        },
      },
      {
        // Migration tests — run explicitly via `pnpm run test:migrations`.
        // Uses toolingAlias to load the system-Node build of better-sqlite3.
        extends: true,
        resolve: { alias: toolingAlias },
        test: {
          name: 'migrations',
          environment: 'node',
          include: ['src/main/db/__tests__/migrations/**/*.test.ts'],
        },
      },
      {
        // Renderer terminal tests that need a real browser environment
        // (real CSS layout, ResizeObserver, requestAnimationFrame, WebGL).
        extends: true,
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          include: ['src/renderer/tests/browser/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});

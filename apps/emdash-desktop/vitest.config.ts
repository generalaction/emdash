import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': resolve(__dirname, 'src'),
  '@core': resolve(__dirname, 'src/core'),
  '@root': resolve(__dirname, '.'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@main': resolve(__dirname, 'src/main'),
  '@tooling': resolve(__dirname, 'tooling'),
};

// For Node-environment Vitest projects, redirect better-sqlite3 to an
// isolated copy installed under tooling/node-deps/ (compiled for system Node).
// The root node_modules/better-sqlite3 stays Electron-compiled at all times,
// so no rebuild dance is needed when switching between app dev and tests.
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
        // DB integration tests (*.db.test.ts) are excluded — run under the main-db project.
        // Uses toolingAlias so slice tests that open real SQLite (e.g. via the
        // sqlite-store primitive) load the system-Node build, not the Electron one.
        extends: true,
        resolve: { alias: toolingAlias },
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: ['src/**/*.test.ts'],
          exclude: [
            '**/_*/**',
            '**/*.db.test.ts',
            '**/*.browser.test.ts',
            'src/renderer/tests/browser/**',
            'src/main/db/tests/migrations/**',
            'src/main/db/legacy-port/**/*.test.ts',
            'src/main/core/**/*.db.test.ts',
          ],
        },
      },
      {
        // Main-process integration tests that need a real SQLite connection.
        // Uses toolingAlias so better-sqlite3 resolves to the system-Node build.
        extends: true,
        resolve: { alias: toolingAlias },
        test: {
          name: 'main-db',
          environment: 'node',
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: [
            'src/core/features/**/*.db.test.ts',
            'src/core/services/**/*.db.test.ts',
            'src/main/core/**/*.db.test.ts',
            'src/main/db/legacy-port/**/*.test.ts',
            'src/main/host/**/*.db.test.ts',
            'src/services/**/*.db.test.ts',
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
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
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
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: ['src/main/db/tests/migrations/**/*.test.ts'],
        },
      },
      {
        // Release script unit tests (artifacts, version helpers).
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
      // The browser project is omitted entirely when EMDASH_TEST_SKIP_BROWSER
      // is set: CI runs without it until Playwright browser provisioning is
      // proven stable there (see .github/workflows/code-consistency-check.yml).
      ...(process.env.EMDASH_TEST_SKIP_BROWSER
        ? []
        : [
            {
              // Renderer tests that need a real browser environment (real CSS
              // layout, ResizeObserver, requestAnimationFrame, WebGL), plus
              // slice-isolation tests colocated with core slices as
              // *.browser.test.{ts,tsx}.
              extends: true as const,
              test: {
                name: 'browser',
                browser: {
                  enabled: true,
                  provider: playwright(),
                  headless: true,
                  instances: [{ browser: 'chromium' }],
                },
                include: [
                  'src/renderer/tests/browser/**/*.test.{ts,tsx}',
                  'src/core/**/*.browser.test.{ts,tsx}',
                ],
              },
            },
          ]),
    ],
  },
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const workspaceServerVersion = (
  JSON.parse(readFileSync(resolve(__dirname, '../workspace-server/package.json'), 'utf8')) as {
    version: string;
  }
).version;

const alias = {
  '@emdash/core/runtimes': resolve(__dirname, '../../packages/core/src/runtimes'),
  '@emdash/core/services': resolve(__dirname, '../../packages/core/src/services'),
  '@emdash/core/primitives': resolve(__dirname, '../../packages/core/src/primitives'),
  '@emdash/core/workspace-server': resolve(__dirname, '../../packages/core/src/workspace-server'),
  '@services/notifications': resolve(__dirname, 'src/services/notifications'),
  '@runtimes': resolve(__dirname, '../../packages/core/src/runtimes'),
  '@services': resolve(__dirname, '../../packages/core/src/services'),
  '@primitives': resolve(__dirname, '../../packages/core/src/primitives'),
  '@workspace-server': resolve(__dirname, '../../packages/core/src/workspace-server'),
  '@': resolve(__dirname, 'src'),
  '@core': resolve(__dirname, 'src/core'),
  '@root': resolve(__dirname, '.'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@main': resolve(__dirname, 'src/main'),
  '@tooling': resolve(__dirname, 'tooling'),
  '@emdash/core/services/fs-watch/api': resolve(
    __dirname,
    '../../packages/core/src/services/fs-watch/api/index.ts'
  ),
  '@emdash/core/services/fs-watch/node': resolve(
    __dirname,
    '../../packages/core/src/services/fs-watch/node/index.ts'
  ),
  '@emdash/plugins/agents/types': resolve(__dirname, '../../packages/plugins/src/agents/types.ts'),
  '@emdash/plugins/agents': resolve(__dirname, '../../packages/plugins/src/agents/registry.ts'),
  '@emdash/shared/config': resolve(__dirname, '../../packages/shared/src/config/index.ts'),
  '@emdash/shared/logger/context-node': resolve(
    __dirname,
    '../../packages/shared/src/logger/context-node.ts'
  ),
  '@emdash/shared/logger/context': resolve(
    __dirname,
    '../../packages/shared/src/logger/context.ts'
  ),
  '@emdash/shared/logger/node': resolve(
    __dirname,
    '../../packages/shared/src/logger/node/index.ts'
  ),
  '@emdash/shared/logger/pino': resolve(
    __dirname,
    '../../packages/shared/src/logger/pino/index.ts'
  ),
  '@emdash/shared/logger/transport': resolve(
    __dirname,
    '../../packages/shared/src/logger/transport/index.ts'
  ),
  '@emdash/shared/logger': resolve(__dirname, '../../packages/shared/src/logger/index.ts'),
  '@emdash/shared/markdown': resolve(__dirname, '../../packages/shared/src/markdown/index.ts'),
  '@emdash/shared/plugins': resolve(__dirname, '../../packages/shared/src/plugins/index.ts'),
  '@emdash/shared/requests': resolve(__dirname, '../../packages/shared/src/requests/index.ts'),
  '@emdash/shared/result': resolve(__dirname, '../../packages/shared/src/result/index.ts'),
  '@emdash/shared/scheduling': resolve(__dirname, '../../packages/shared/src/scheduling/index.ts'),
  '@emdash/shared/concurrency': resolve(
    __dirname,
    '../../packages/shared/src/concurrency/index.ts'
  ),
  '@emdash/shared/util': resolve(__dirname, '../../packages/shared/src/util/index.ts'),
  '@emdash/shared/testing': resolve(__dirname, '../../packages/shared/src/testing/index.ts'),
  '@emdash/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
  '@emdash/wire/api': resolve(__dirname, '../../packages/wire/src/api/index.ts'),
  '@emdash/wire/component': resolve(__dirname, '../../packages/wire/src/component/index.ts'),
  '@emdash/wire/testing': resolve(__dirname, '../../packages/wire/src/testing/index.ts'),
  '@emdash/wire/util/mobx': resolve(__dirname, '../../packages/wire/src/util/mobx/index.ts'),
  '@emdash/wire/util': resolve(__dirname, '../../packages/wire/src/util/index.ts'),
  '@emdash/wire/worker/electron': resolve(
    __dirname,
    '../../packages/wire/src/worker/electron/index.ts'
  ),
  '@emdash/wire/worker/node': resolve(__dirname, '../../packages/wire/src/worker/node/index.ts'),
  '@emdash/wire/worker': resolve(__dirname, '../../packages/wire/src/worker/index.ts'),
  '@emdash/wire': resolve(__dirname, '../../packages/wire/src/index.ts'),
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
  define: {
    __EMDASH_WORKSPACE_SERVER_VERSION__: JSON.stringify(workspaceServerVersion),
  },
  resolve: { alias },
  test: {
    projects: [
      {
        // All existing tests that run in a Node.js environment.
        // Migration tests are excluded — run them via `pnpm run test:migrations`.
        // DB integration tests (*.db.test.ts) are excluded — run under the main-db project.
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: [resolve(__dirname, 'tooling/vitest/setup-app-config.ts')],
          include: ['src/**/*.test.ts'],
          exclude: [
            '**/_*/**',
            '**/*.db.test.ts',
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

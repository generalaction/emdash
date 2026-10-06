import { parseAbsolute } from '@emdash/core/primitives/path/api';
import type * as HostDependenciesModule from '@emdash/core/services/host-dependencies/node';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import type * as WireWorkerModule from '@emdash/wire/worker';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startDesktopWorkers } from './desktop-workers';

const mocks = vi.hoisted(() => ({ ready: vi.fn<(name: string) => Promise<unknown>>() }));

vi.mock('@emdash/wire/worker', async (importOriginal) => ({
  ...(await importOriginal<typeof WireWorkerModule>()),
  createWireWorkerHost: () => ({
    create: (_component: unknown, options: { name: string }) => ({
      ready: () => mocks.ready(options.name),
      onStateChanged: () => () => {},
      stop: async () => {},
    }),
    dispose: async () => {},
  }),
}));
vi.mock('@emdash/core/services/host-dependencies/node', async (importOriginal) => ({
  ...(await importOriginal<typeof HostDependenciesModule>()),
  createHostDependenciesComponent: () => ({ create: () => ({ client: { resolver: {} } }) }),
}));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/emdash-worker-test' } }));
vi.mock('@main/lib/logger', async () => ({
  log: (await import('@emdash/shared/logger')).noopLogger,
}));
vi.mock('@main/lib/telemetry', () => ({ telemetryService: { capture: vi.fn() } }));
vi.mock('@main/lib/userEnv', () => ({
  userShellEnvManager: { current: async () => ({}) },
  refreshUserEnv: async () => ({}),
}));
vi.mock('@main/db/kv', () => ({ desktopKeyValueStore: {} }));
vi.mock('@main/db/instance', () => ({ getAppDb: vi.fn() }));
vi.mock('@main/db/path', () => ({ resolveDatabasePath: () => '/tmp/emdash-worker-test/app.db' }));
vi.mock('@main/core/file-search/database-path', () => ({
  resolveFileSearchDatabasePath: () => '/tmp/emdash-worker-test/file-search.db',
}));
vi.mock('@main/core/runtime/session-intent-stores', () => ({
  sessionIntentFilePaths: () => ({ acp: '/tmp/acp-intents', tuiAgents: '/tmp/tui-intents' }),
}));
vi.mock('@main/core/utils/exec', () => ({ getGitExecutable: () => 'git' }));
vi.mock('@main/core/provider-accounts/provider-account-registry-instance', () => ({
  providerAccountRegistry: {},
}));
vi.mock('@core/features/integrations/node/integration-account-store-instance', () => ({
  getIntegrationAccountStore: vi.fn(),
}));
vi.mock('@core/services/pull-requests/node/sync-identity', () => ({
  resolvePullRequestSyncIdentity: vi.fn(),
}));
vi.mock('./worker-paths', () => ({ desktopWorkerPath: (name: string) => `/tmp/${name}.mjs` }));

describe('desktop runtime readiness', () => {
  it.each(['fails', 'stalls'] as const)(
    'keeps required runtimes available and recovers after LSP startup %s',
    async (mode) => {
      const scope = createScope();
      onTestFinished(() => scope.dispose());
      const failure = new Error('LSP worker failed to start');
      const pending = deferred<unknown>();
      const getSettings = vi.fn(async () => ({ success: true }));
      const lspReady = vi.fn(() => (mode === 'fails' ? Promise.reject(failure) : pending.promise));
      mocks.ready.mockImplementation((name) => {
        if (name === 'lsp') return lspReady();
        return Promise.resolve({ get: getSettings });
      });
      const workers = await startDesktopWorkers({
        scope,
        getFilesSettings: async () => ({ watcherExclude: [] }),
      });
      onTestFinished(() => workers.dispose());
      await expect(workers.runtimeReady()).resolves.toBeUndefined();
      expect(lspReady).not.toHaveBeenCalled();

      const root = parseAbsolute('/workspace', { profile: { style: 'posix' } });
      if (!root.success) throw new Error(root.error.message);
      const input = { workspaceRoot: root.data, path: root.data, serverId: 'typescript' };
      const discovery = workers.clients.lsp.resolveProjectRoot(input);
      const rejected = expect(discovery).rejects.toBe(failure);
      await expect(workers.runtimeReady()).resolves.toBeUndefined();
      await expect(workers.clients.hostSettings.get()).resolves.toMatchObject({ success: true });
      if (mode === 'stalls') pending.reject(failure);
      await rejected;
      expect(lspReady).toHaveBeenCalledOnce();

      const resolveProjectRoot = vi.fn(async () => ok(root.data));
      lspReady.mockResolvedValue({ resolveProjectRoot });
      await expect(
        Promise.all([
          workers.clients.lsp.resolveProjectRoot(input),
          workers.clients.lsp.resolveProjectRoot(input),
        ])
      ).resolves.toEqual([ok(root.data), ok(root.data)]);
      await expect(workers.clients.lsp.resolveProjectRoot(input)).resolves.toEqual(ok(root.data));
      expect(lspReady).toHaveBeenCalledTimes(2);
      expect(resolveProjectRoot).toHaveBeenCalledTimes(3);
    }
  );

  it.each(['fails', 'stalls'] as const)(
    'keeps required runtimes available and recovers after provider usage %s',
    async (mode) => {
      const scope = createScope();
      onTestFinished(() => scope.dispose());
      const failure = new Error('Usage worker failed to start');
      const pending = deferred<unknown>();
      const getSettings = vi.fn(async () => ({ success: true }));
      const usageReady = vi.fn(() =>
        mode === 'fails' ? Promise.reject(failure) : pending.promise
      );
      mocks.ready.mockImplementation((name) => {
        if (name === 'provider-usage') return usageReady();
        return Promise.resolve({ get: getSettings });
      });
      const workers = await startDesktopWorkers({
        scope,
        getFilesSettings: async () => ({ watcherExclude: [] }),
      });
      onTestFinished(() => workers.dispose());
      await expect(workers.runtimeReady()).resolves.toBeUndefined();
      await expect(workers.clients.hostSettings.get()).resolves.toMatchObject({ success: true });
      expect(usageReady).not.toHaveBeenCalled();
      const refresh = workers.clients.providerUsage.refresh(undefined);
      const rejected = expect(refresh).rejects.toBe(failure);
      if (mode === 'stalls') {
        await expect(workers.runtimeReady()).resolves.toBeUndefined();
        pending.reject(failure);
      }
      await rejected;
      expect(usageReady).toHaveBeenCalledOnce();

      const refreshUsage = vi.fn(async () => {});
      usageReady.mockResolvedValue({ refresh: refreshUsage });
      await expect(workers.clients.providerUsage.refresh(undefined)).resolves.toBeUndefined();
      await expect(workers.clients.providerUsage.refresh(undefined)).resolves.toBeUndefined();
      expect(usageReady).toHaveBeenCalledTimes(2);
      expect(refreshUsage).toHaveBeenCalledTimes(2);
    }
  );
});

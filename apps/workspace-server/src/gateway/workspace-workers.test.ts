import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAbsolute } from '@emdash/core/primitives/path/api';
import type * as HostDependenciesModule from '@emdash/core/services/host-dependencies/node';
import type { ShellEnvManager } from '@emdash/core/services/shell-env/node';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import type * as WireWorkerModule from '@emdash/wire/worker';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { createWorkspaceServerRuntimeHost } from './workspace-workers';

const mocks = vi.hoisted(() => ({ ready: vi.fn<(name: string) => Promise<unknown>>() }));

vi.mock('@emdash/wire/worker', async (importOriginal) => ({
  ...(await importOriginal<typeof WireWorkerModule>()),
  createWireWorkerHost: () => ({
    create: (_component: unknown, options: { name: string }) => ({
      ready: () => mocks.ready(options.name),
    }),
    spawn: (_component: unknown, options: { name: string }) => mocks.ready(options.name),
  }),
}));

vi.mock('@emdash/core/services/host-dependencies/node', async (importOriginal) => ({
  ...(await importOriginal<typeof HostDependenciesModule>()),
  createHostDependenciesComponent: () => ({ create: () => ({ client: { resolver: {} } }) }),
}));

describe('workspace runtime readiness', () => {
  it.each(['fails', 'stalls'] as const)(
    'keeps required runtimes available and recovers after LSP startup %s',
    async (mode) => {
      const scope = createScope();
      const directory = await mkdtemp(join(tmpdir(), 'emdash-lsp-workers-'));
      onTestFinished(async () => {
        await scope.dispose();
        await rm(directory, { recursive: true, force: true });
      });
      const failure = new Error('LSP worker failed to start');
      const pending = deferred<unknown>();
      const getSettings = vi.fn(async () => ({
        success: true,
        data: { settings: { watcherExclude: [] } },
      }));
      const lspReady = vi.fn(() => (mode === 'fails' ? Promise.reject(failure) : pending.promise));
      mocks.ready.mockImplementation((name) => {
        if (name === 'lsp') return lspReady();
        return Promise.resolve({ get: getSettings });
      });
      const host = await createWorkspaceServerRuntimeHost({
        scope,
        socketPath: join(directory, 'server.sock'),
        shellEnv: { env: {}, current: async () => ({}) } as ShellEnvManager,
      });
      expect(lspReady).not.toHaveBeenCalled();

      const root = parseAbsolute('/workspace', { profile: { style: 'posix' } });
      if (!root.success) throw new Error(root.error.message);
      const input = { workspaceRoot: root.data, path: root.data, serverId: 'typescript' };
      const discovery = host.runtimes.lsp.resolveProjectRoot(input);
      const rejected = expect(discovery).rejects.toBe(failure);
      await expect(host.runtimes.hostSettings.get()).resolves.toMatchObject({ success: true });
      if (mode === 'stalls') pending.reject(failure);
      await rejected;
      expect(lspReady).toHaveBeenCalledOnce();

      const resolveProjectRoot = vi.fn(async () => ok(root.data));
      lspReady.mockResolvedValue({ resolveProjectRoot });
      await expect(
        Promise.all([
          host.runtimes.lsp.resolveProjectRoot(input),
          host.runtimes.lsp.resolveProjectRoot(input),
        ])
      ).resolves.toEqual([ok(root.data), ok(root.data)]);
      await expect(host.runtimes.lsp.resolveProjectRoot(input)).resolves.toEqual(ok(root.data));
      expect(lspReady).toHaveBeenCalledTimes(2);
      expect(resolveProjectRoot).toHaveBeenCalledTimes(3);
    }
  );

  it.each(['fails', 'stalls'] as const)(
    'keeps required runtimes available and recovers after provider usage %s',
    async (mode) => {
      const scope = createScope();
      const directory = await mkdtemp(join(tmpdir(), 'emdash-usage-workers-'));
      onTestFinished(async () => {
        await scope.dispose();
        await rm(directory, { recursive: true, force: true });
      });
      const failure = new Error('Usage worker failed to start');
      const pending = deferred<unknown>();
      const getSettings = vi.fn(async () => ({
        success: true,
        data: { settings: { watcherExclude: [] } },
      }));
      const usageReady = vi.fn(() =>
        mode === 'fails' ? Promise.reject(failure) : pending.promise
      );
      mocks.ready.mockImplementation((name) => {
        if (name === 'provider-usage') return usageReady();
        return Promise.resolve({ get: getSettings });
      });
      const host = await createWorkspaceServerRuntimeHost({
        scope,
        socketPath: join(directory, 'server.sock'),
        shellEnv: {
          env: {},
          current: async () => ({}),
        } as ShellEnvManager,
      });
      await expect(host.runtimes.hostSettings.get()).resolves.toMatchObject({ success: true });
      expect(usageReady).not.toHaveBeenCalled();
      const refresh = host.runtimes.providerUsage.refresh(undefined);
      const rejected = expect(refresh).rejects.toBe(failure);
      if (mode === 'stalls') {
        await expect(host.runtimes.hostSettings.get()).resolves.toMatchObject({ success: true });
        pending.reject(failure);
      }
      await rejected;
      expect(usageReady).toHaveBeenCalledOnce();

      const refreshUsage = vi.fn(async () => {});
      usageReady.mockResolvedValue({ refresh: refreshUsage });
      await expect(host.runtimes.providerUsage.refresh(undefined)).resolves.toBeUndefined();
      await expect(host.runtimes.providerUsage.refresh(undefined)).resolves.toBeUndefined();
      expect(usageReady).toHaveBeenCalledTimes(2);
      expect(refreshUsage).toHaveBeenCalledTimes(2);
    }
  );
});

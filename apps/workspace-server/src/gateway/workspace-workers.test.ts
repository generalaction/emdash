import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as HostDependenciesModule from '@emdash/core/services/host-dependencies/node';
import type { ShellEnvManager } from '@emdash/core/services/shell-env/node';
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
    'keeps required runtimes available when provider usage %s',
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
      mocks.ready.mockImplementation((name) => {
        if (name === 'provider-usage')
          return mode === 'fails' ? Promise.reject(failure) : pending.promise;
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
      const refresh = host.runtimes.providerUsage.refresh(undefined);
      const rejected = expect(refresh).rejects.toBe(failure);
      if (mode === 'stalls') {
        await expect(host.runtimes.hostSettings.get()).resolves.toMatchObject({ success: true });
        pending.reject(failure);
      }
      await rejected;
    }
  );
});

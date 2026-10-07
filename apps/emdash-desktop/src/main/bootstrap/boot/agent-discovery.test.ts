import type { IExecutionContext } from '@emdash/core/primitives/exec/api';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { createMemoryKeyValueStore } from '@emdash/core/primitives/kv/api';
import {
  createHostDependenciesController,
  hostDependenciesContract,
  HostDependenciesRuntime,
} from '@emdash/core/services/host-dependencies/node';
import { ok } from '@emdash/shared';
import { createTestWire } from '@emdash/wire/testing';
import { expect, it, vi } from 'vitest';
import { agentsContract } from '@core/features/agents/api';
import { createAgentOperations } from '@core/features/agents/node/controller';
import { createAgentsWireController } from '@core/features/agents/node/wire-controller';
import { ensureAgentDependenciesProbed } from '@main/core/dependencies/dependency-managers';
import { DEPENDENCIES } from '@main/core/dependencies/registry';

it('serves concurrent agent reads during slow Windows discovery within the Wire deadline', async () => {
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  vi.useFakeTimers();
  const exec = {
    root: '',
    supportsLocalSpawn: true,
    exec: vi.fn(async (command: string, args: string[] = []) => {
      expect(command).toBe('where');
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { stdout: args[0] === 'claude' ? 'C:\\Tools\\claude.exe\r\n' : '', stderr: '' };
    }),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } satisfies IExecutionContext;
  const runtime = new HostDependenciesRuntime({
    hostId: 'local',
    definitions: DEPENDENCIES,
    exec,
    store: createMemoryKeyValueStore(),
  });
  const dependencies = createTestWire(
    hostDependenciesContract,
    createHostDependenciesController(runtime)
  );
  const operations = createAgentOperations({
    ensureAgentDependenciesProbed,
    getDependencyManager: async () => ok(dependencies.client),
    providerOverrideSettings: {
      getItemWithMeta: async () => ({ defaults: {}, overrides: {}, effective: {} }),
    } as never,
  });
  const agents = createTestWire(
    agentsContract,
    createAgentsWireController({
      operations,
      runtimes: { client: async () => ok({ hostDependencies: dependencies.client }) } as never,
    })
  );
  try {
    // Startup refresh, Settings list and status reads overlap in the shipped app.
    const pending = Promise.all([
      agents.client.probeAll({ host: LOCAL_HOST_REF }),
      agents.client.list({ host: LOCAL_HOST_REF }),
      agents.client.listAgentInstallationStatus({ host: LOCAL_HOST_REF }),
    ]);
    let outcome: unknown;
    void pending.then(
      (value) => {
        outcome = { value };
      },
      (error: unknown) => {
        outcome = { error };
      }
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(outcome).toMatchObject({
      value: [
        { success: true },
        {
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              id: 'claude',
              status: 'available',
              command: 'C:\\Tools\\claude.exe',
            }),
          ]),
        },
        { success: true },
      ],
    });

    const probes = exec.exec.mock.calls.length;
    const reads = Promise.all([
      agents.client.list({ host: LOCAL_HOST_REF }),
      agents.client.get({ host: LOCAL_HOST_REF, id: 'claude' }),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    await reads;
    expect(exec.exec).toHaveBeenCalledTimes(probes);
  } finally {
    // Drain callers before disposal so failed regression runs do not leak promises.
    await vi.advanceTimersByTimeAsync(60_000);
    await agents.dispose();
    await dependencies.dispose();
    runtime.dispose();
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

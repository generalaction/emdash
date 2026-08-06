import { hostRef } from '@emdash/core/primitives/host/api';
import {
  GIT_DEPENDENCY_DESCRIPTOR,
  NODE_DEPENDENCY_DESCRIPTOR,
  type HostDependencyDefinition,
  type HostDependencySnapshot,
  type HostDependencyView,
} from '@emdash/core/services/host-dependencies/node';
import { runtimeHostUnavailable } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { createLiveJobReplica, LiveJobCancelledError } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { machinesContract, type InstallMachineSystemDependenciesInput } from '../api';
import type { MachinesService } from '../api/node/machines-service';
import { createMachinesWireController } from './wire-controller';

const runRuntimeLiveJob = vi.hoisted(() => vi.fn());

vi.mock('@core/services/runtime-clients/node/live-job', () => ({
  runRuntimeLiveJob,
}));

const remoteHost = hostRef('remote', 'ssh-1');

describe('createMachinesWireController system dependencies', () => {
  it('lists classified core dependencies for a machine runtime', async () => {
    const agentView = hostDependencyView({
      id: 'fake-agent',
      name: 'Fake Agent',
      category: 'agent',
      binaryNames: ['fake-agent'],
      status: 'active',
    });
    const snapshot = hostDependencySnapshot([
      hostDependencyView(GIT_DEPENDENCY_DESCRIPTOR, { resolvedPath: '/usr/bin/git' }),
      hostDependencyView(NODE_DEPENDENCY_DESCRIPTOR),
      agentView,
    ]);
    const refresh = vi.fn(async () => ({ success: true as const, data: { data: snapshot } }));
    const client = vi.fn(async () =>
      ok({
        hostDependencies: {
          snapshot: {
            mutate: refresh,
          },
        },
      })
    );
    const controller = createMachinesWireController(createService(), { client } as never);

    await expect(
      controller.call('getMachineSystemDependencies', { machineId: 'ssh-1' })
    ).resolves.toEqual([
      {
        id: 'git',
        name: 'Git',
        tier: 'required',
        status: 'available',
        path: '/usr/bin/git',
        installDocs: 'https://git-scm.com/downloads',
        installOptions: GIT_DEPENDENCY_DESCRIPTOR.installCommands?.macos ?? [],
      },
      {
        id: 'node',
        name: 'Node.js',
        tier: 'recommended',
        status: 'missing',
        path: null,
        installDocs: 'https://nodejs.org/en/download',
        installOptions: NODE_DEPENDENCY_DESCRIPTOR.installCommands?.macos ?? [],
      },
    ]);
    expect(client).toHaveBeenCalledWith(remoteHost);
    expect(refresh).toHaveBeenCalledWith('refresh', { key: undefined, input: {} });
  });

  it('installs a classified system dependency through the machine runtime batch job', async () => {
    const view = hostDependencyView(GIT_DEPENDENCY_DESCRIPTOR, { resolvedPath: '/usr/bin/git' });
    runRuntimeLiveJob.mockResolvedValueOnce(ok({ git: ok(view) }));
    const runInstallBatch = {};
    const client = vi.fn(async () => ok({ hostDependencies: { runInstallBatch } }));
    const controller = createMachinesWireController(createService(), { client } as never);

    await expect(
      runInstallJob(controller, {
        machineId: 'ssh-1',
        dependencies: [{ id: 'git', method: 'homebrew' }],
      })
    ).resolves.toEqual({
      git: ok({
        id: 'git',
        name: 'Git',
        tier: 'required',
        status: 'available',
        path: '/usr/bin/git',
        installDocs: 'https://git-scm.com/downloads',
        installOptions: GIT_DEPENDENCY_DESCRIPTOR.installCommands?.macos ?? [],
      }),
    });
    expect(runRuntimeLiveJob).toHaveBeenCalledWith(
      expect.anything(),
      runInstallBatch,
      { requests: [{ id: 'git', method: 'homebrew' }] },
      expect.any(Function),
      { signal: expect.any(AbortSignal) }
    );
  });

  it('rejects non-system dependency installation ids', async () => {
    const client = vi.fn(async () => ok({ hostDependencies: { runInstallBatch: {} } }));
    const controller = createMachinesWireController(createService(), { client } as never);

    await expect(
      runInstallJob(controller, {
        machineId: 'ssh-1',
        dependencies: [{ id: 'fake-agent' }],
      })
    ).resolves.toEqual({
      'fake-agent': err({ type: 'unknown-dependency', id: 'fake-agent' }),
    });
    expect(client).not.toHaveBeenCalled();
  });

  it('maps batched install results per system dependency', async () => {
    const gitView = hostDependencyView(GIT_DEPENDENCY_DESCRIPTOR, {
      resolvedPath: '/usr/bin/git',
    });
    runRuntimeLiveJob.mockResolvedValueOnce(
      ok({
        git: ok(gitView),
        node: err({
          type: 'command-failed',
          message: 'apt failed',
          output: 'lock timeout',
          exitCode: 100,
        }),
      })
    );
    const runInstallBatch = {};
    const client = vi.fn(async () => ok({ hostDependencies: { runInstallBatch } }));
    const controller = createMachinesWireController(createService(), { client } as never);

    await expect(
      runInstallJob(controller, {
        machineId: 'ssh-1',
        dependencies: [{ id: 'git' }, { id: 'node', method: 'apt' }],
      })
    ).resolves.toEqual({
      git: ok({
        id: 'git',
        name: 'Git',
        tier: 'required',
        status: 'available',
        path: '/usr/bin/git',
        installDocs: 'https://git-scm.com/downloads',
        installOptions: GIT_DEPENDENCY_DESCRIPTOR.installCommands?.macos ?? [],
      }),
      node: err({
        type: 'command-failed',
        message: 'apt failed',
        output: 'lock timeout',
        exitCode: 100,
      }),
    });
    expect(runRuntimeLiveJob).toHaveBeenCalledWith(
      expect.anything(),
      runInstallBatch,
      { requests: [{ id: 'git' }, { id: 'node', method: 'apt' }] },
      expect.any(Function),
      { signal: expect.any(AbortSignal) }
    );
  });

  it('forwards live job cancellation to the runtime batch job', async () => {
    const receivedSignal = deferred<AbortSignal>();
    runRuntimeLiveJob.mockImplementationOnce(
      async (_definition, _handle, _input, _progress, options: { signal: AbortSignal }) => {
        receivedSignal.resolve(options.signal);
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), { once: true })
        );
        return err({ type: 'io', message: 'cancelled' });
      }
    );
    const client = vi.fn(async () => ok({ hostDependencies: { runInstallBatch: {} } }));
    const controller = createMachinesWireController(createService(), { client } as never);
    const wire = createTestWire(machinesContract, controller);
    const jobs = createLiveJobReplica(
      machinesContract.installSystemDependencies,
      wire.client.installSystemDependencies
    );
    const lease = await jobs.start({ dependencies: [{ id: 'git' }] });
    const job = await lease.ready();
    const signal = await receivedSignal.promise;

    await job.cancel();

    expect(signal.aborted).toBe(true);
    await expect(job.result).rejects.toBeInstanceOf(LiveJobCancelledError);
    await lease.release();
    await jobs.dispose();
    await wire.dispose();
  });

  it('throws runtime resolve errors for unavailable machine runtimes', async () => {
    const runtimeError = runtimeHostUnavailable(remoteHost, 'unavailable');
    const controller = createMachinesWireController(createService(), {
      client: async () => err(runtimeError),
    } as never);

    await expect(
      controller.call('getMachineSystemDependencies', { machineId: 'ssh-1' })
    ).rejects.toThrow('unavailable');
  });
});

function hostDependencySnapshot(views: HostDependencyView[]): HostDependencySnapshot {
  return {
    hostId: 'test-host',
    generation: 1,
    hostElevation: null,
    dependencies: Object.fromEntries(views.map((view) => [view.definition.id, view])),
  };
}

function hostDependencyView(
  definition: HostDependencyDefinition,
  options: {
    resolvedPath?: string | null;
    status?: HostDependencyView['status'];
  } = {}
): HostDependencyView {
  const resolvedPath = options.resolvedPath ?? null;
  return {
    hostId: 'test-host',
    definition,
    installOptions: definition.installCommands?.macos ?? [],
    selection: null,
    candidates: [],
    resolved: resolvedPath
      ? {
          id: definition.id,
          command: definition.binaryNames[0] ?? definition.id,
          path: resolvedPath,
          realpath: resolvedPath,
          source: { kind: 'auto' },
        }
      : null,
    status: options.status ?? (resolvedPath ? 'available' : 'missing'),
    checkedAt: 1,
  };
}

function createService(): MachinesService {
  return {
    getMachines: vi.fn(),
    getMachineUsage: vi.fn(),
    saveMachine: vi.fn(),
    deleteMachine: vi.fn(),
    renameMachine: vi.fn(),
  } as never;
}

async function runInstallJob(
  controller: ReturnType<typeof createMachinesWireController>,
  input: InstallMachineSystemDependenciesInput
) {
  const wire = createTestWire(machinesContract, controller);
  const jobs = createLiveJobReplica(
    machinesContract.installSystemDependencies,
    wire.client.installSystemDependencies
  );
  const lease = await jobs.start(input);
  try {
    const job = await lease.ready();
    return await job.result;
  } finally {
    await lease.release();
    await jobs.dispose();
    await wire.dispose();
  }
}

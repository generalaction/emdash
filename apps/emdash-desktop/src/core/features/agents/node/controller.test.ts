import { hostDependenciesContract } from '@emdash/core/services/host-dependencies/node';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentOperations } from './controller';

const runRuntimeLiveJob = vi.hoisted(() => vi.fn());

vi.mock('@core/services/runtime-clients/node/live-job', () => ({
  runRuntimeLiveJob,
}));

describe('createAgentOperations update routing', () => {
  beforeEach(() => {
    runRuntimeLiveJob.mockReset();
    runRuntimeLiveJob.mockResolvedValue(err({ type: 'no-update-command', id: 'codex' }));
  });

  it('routes package-manager updates through the install command job', async () => {
    const runInstallCommand = {};
    const manager = { runInstallCommand };
    const operations = createOperations();

    await operations.update('codex', undefined, 'npm', true, manager as never);

    expect(runRuntimeLiveJob).toHaveBeenCalledWith(
      hostDependenciesContract.runInstallCommand,
      runInstallCommand,
      {
        id: 'codex',
        method: 'npm',
        elevate: true,
        commandKind: 'update',
      },
      undefined,
      { signal: undefined }
    );
  });

  it('routes cli updates through the unelevated self-update job', async () => {
    const runSelfUpdateCommand = {};
    const manager = { runSelfUpdateCommand };
    const operations = createOperations();

    await operations.update('claude', undefined, undefined, undefined, manager as never);

    expect(runRuntimeLiveJob).toHaveBeenCalledWith(
      hostDependenciesContract.runSelfUpdateCommand,
      runSelfUpdateCommand,
      { id: 'claude' },
      undefined,
      { signal: undefined }
    );
  });

  it('forwards cancellation and progress context to the runtime job', async () => {
    const runInstallCommand = {};
    const manager = { runInstallCommand };
    const operations = createOperations();
    const signal = new AbortController().signal;
    const progress = vi.fn();

    await operations.install('codex', undefined, 'npm', false, manager as never, {
      signal,
      progress,
    });

    expect(runRuntimeLiveJob).toHaveBeenCalledWith(
      hostDependenciesContract.runInstallCommand,
      runInstallCommand,
      { id: 'codex', method: 'npm', elevate: false },
      progress,
      { signal }
    );
  });
});

function createOperations() {
  return createAgentOperations({
    ensureAgentDependenciesProbed: vi.fn(),
    getDependencyManager: vi.fn(),
    providerOverrideSettings: {} as never,
  });
}

describe('executable overrides', () => {
  it('probes through the supplied host client without persisting', async () => {
    const resolved = {
      id: 'claude',
      command: 'wrapper',
      path: '/remote/bin/wrapper',
      realpath: '/remote/bin/wrapper',
      source: { kind: 'cli', command: 'wrapper' },
    };
    const resolve = vi.fn(async () => ok(resolved));
    const mutate = vi.fn();
    const operations = createOperations();
    expect(
      await operations.resolveInstallation(
        'claude',
        { kind: 'cli', command: 'wrapper' },
        'remote',
        {
          resolver: { resolve },
          snapshot: { mutate },
        } as never
      )
    ).toEqual(ok(resolved));
    expect(resolve).toHaveBeenCalledWith({
      id: 'claude',
      selection: { kind: 'cli', command: 'wrapper' },
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('preserves command names and propagates save errors', async () => {
    const failure = err({ type: 'io', message: 'disk full' });
    const mutate = vi.fn(async () => failure);
    expect(
      await createOperations().setUsedInstallation(
        'claude',
        undefined,
        { kind: 'cli', command: 'wrapper' },
        { snapshot: { mutate } } as never
      )
    ).toEqual(failure);
    expect(mutate).toHaveBeenCalledWith('setSelection', {
      key: undefined,
      input: { id: 'claude', selection: { kind: 'cli', command: 'wrapper' } },
    });
  });
});

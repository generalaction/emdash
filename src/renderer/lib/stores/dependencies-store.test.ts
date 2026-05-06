import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { DependencyState, DependencyStatusUpdatedEvent } from '@shared/dependencies';
import { err, ok } from '@shared/result';
import { DependenciesStore } from './dependencies-store';

let dependencyEventHandler: ((event: DependencyStatusUpdatedEvent) => void) | null = null;

vi.mock('../../lib/ipc', () => ({
  events: {
    on: vi.fn((_channel, handler) => {
      dependencyEventHandler = handler;
      return () => {};
    }),
  },
  rpc: {
    dependencies: {
      getAll: vi.fn(async () => ({})),
      install: vi.fn(),
      probeAll: vi.fn(async () => {}),
      probeCategory: vi.fn(async () => {}),
    },
  },
}));

const { rpc } = await import('../../lib/ipc');

function availableAgent(id: AgentProviderId): DependencyState {
  return {
    id,
    category: 'agent' as const,
    status: 'available' as const,
    version: '1.0.0',
    path: `/bin/${id}`,
    checkedAt: 1,
  };
}

describe('DependenciesStore install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencyEventHandler = null;
  });

  it('updates local dependency state after a local install', async () => {
    vi.mocked(rpc.dependencies.install).mockResolvedValueOnce(ok(availableAgent('codex')));
    vi.mocked(rpc.dependencies.getAll).mockResolvedValueOnce({ codex: availableAgent('codex') });
    const store = new DependenciesStore();

    const result = await store.install('codex');

    expect(result.success).toBe(true);
    expect(rpc.dependencies.install).toHaveBeenCalledWith('codex', undefined);
    expect(rpc.dependencies.probeCategory).toHaveBeenCalledWith('agent', undefined);
    expect(store.local.data?.codex?.status).toBe('available');
  });

  it('does not update local dependency state after a failed install result', async () => {
    vi.mocked(rpc.dependencies.install).mockResolvedValueOnce(
      err({
        type: 'permission-denied' as const,
        message: 'User does not have sufficient permissions.',
        output: 'permission denied',
        exitCode: 243,
      })
    );
    const store = new DependenciesStore();

    const result = await store.install('codex');

    expect(result.success).toBe(false);
    expect(store.local.data?.codex).toBeUndefined();
  });

  it('updates remote dependency state after a remote install', async () => {
    vi.mocked(rpc.dependencies.install).mockResolvedValueOnce(ok(availableAgent('claude')));
    vi.mocked(rpc.dependencies.getAll).mockResolvedValueOnce({ claude: availableAgent('claude') });
    const store = new DependenciesStore();
    const remote = store.getRemote('ssh-1');
    remote.setValue({});

    await store.install('claude', 'ssh-1');

    expect(rpc.dependencies.install).toHaveBeenCalledWith('claude', 'ssh-1');
    expect(remote.data?.claude?.status).toBe('available');
    expect(store.local.data?.claude).toBeUndefined();
  });

  it('preserves existing remote dependency state after a remote install', async () => {
    vi.mocked(rpc.dependencies.install).mockResolvedValueOnce(ok(availableAgent('claude')));
    vi.mocked(rpc.dependencies.getAll).mockResolvedValueOnce({
      codex: availableAgent('codex'),
      claude: availableAgent('claude'),
    });
    const store = new DependenciesStore();
    const remote = store.getRemote('ssh-1');
    remote.setValue({ codex: availableAgent('codex') });

    await store.install('claude', 'ssh-1');

    expect(remote.data?.codex?.status).toBe('available');
    expect(remote.data?.claude?.status).toBe('available');
  });

  it('refreshes all remote agent states after an install when the remote state was unknown', async () => {
    vi.mocked(rpc.dependencies.install).mockResolvedValueOnce(ok(availableAgent('claude')));
    vi.mocked(rpc.dependencies.getAll).mockResolvedValueOnce({
      codex: availableAgent('codex'),
      claude: availableAgent('claude'),
    });
    const store = new DependenciesStore();

    await store.install('claude', 'ssh-1');

    expect(rpc.dependencies.probeCategory).toHaveBeenCalledWith('agent', 'ssh-1');
    expect(rpc.dependencies.getAll).toHaveBeenCalledWith('ssh-1');
    expect(store.getRemote('ssh-1').data?.codex?.status).toBe('available');
    expect(store.getRemote('ssh-1').data?.claude?.status).toBe('available');
  });

  it('refreshes an existing remote dependency resource on reconnect', async () => {
    vi.mocked(rpc.dependencies.getAll).mockResolvedValueOnce({
      codex: availableAgent('codex'),
      claude: availableAgent('claude'),
    });
    const store = new DependenciesStore();
    const remote = store.getRemote('ssh-1');
    remote.setValue({ codex: availableAgent('codex') });

    await store.refreshAgents('ssh-1');

    expect(rpc.dependencies.probeCategory).toHaveBeenCalledWith('agent', 'ssh-1');
    expect(remote.data?.codex?.status).toBe('available');
    expect(remote.data?.claude?.status).toBe('available');
  });

  it('creates and refreshes a remote dependency resource on reconnect', async () => {
    vi.mocked(rpc.dependencies.getAll).mockResolvedValueOnce({
      codex: availableAgent('codex'),
      claude: availableAgent('claude'),
    });
    const store = new DependenciesStore();

    await store.refreshAgents('ssh-1');

    expect(rpc.dependencies.probeCategory).toHaveBeenCalledWith('agent', 'ssh-1');
    expect(store.getRemote('ssh-1').data?.codex?.status).toBe('available');
    expect(store.getRemote('ssh-1').data?.claude?.status).toBe('available');
  });

  it('applies streamed remote dependency events to the matching remote resource', () => {
    const store = new DependenciesStore();
    store.start();

    dependencyEventHandler?.({
      id: 'claude',
      connectionId: 'ssh-1',
      state: availableAgent('claude'),
    });

    expect(store.getRemote('ssh-1').data?.claude?.status).toBe('available');
    expect(store.local.data?.claude).toBeUndefined();
  });

  it('tracks in-flight installs by dependency and connection', async () => {
    let resolveInstall: (value: Awaited<ReturnType<typeof rpc.dependencies.install>>) => void;
    vi.mocked(rpc.dependencies.install).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInstall = resolve;
      })
    );
    vi.mocked(rpc.dependencies.getAll).mockResolvedValueOnce({ codex: availableAgent('codex') });
    const store = new DependenciesStore();

    const install = store.install('codex', 'ssh-1');

    expect(store.isInstalling('codex', 'ssh-1')).toBe(true);
    expect(store.isInstalling('codex')).toBe(false);

    resolveInstall!(ok(availableAgent('codex')));
    await install;

    expect(store.isInstalling('codex', 'ssh-1')).toBe(false);
  });
});

import { deferred, type Deferred } from '@emdash/shared/testing';
import { createLiveModelHost } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { machinesContract, type SaveMachineInput } from '@core/features/machines/api';
import type { SshConfig } from '@core/primitives/ssh/api';
import { sshContract, type SshConnectionsRuntime } from '@core/services/ssh/api';
import { MachinesStore } from './machines-store';

const savedConnection: SshConfig = {
  id: 'ssh-1',
  name: 'Corp',
  host: 'corp.example.com',
  port: 22,
  username: 'alice',
  authType: 'agent',
  useAgent: true,
};

describe('MachinesStore', () => {
  it('notifies for initially connected entries and connected transitions only', async () => {
    const onConnectionReady = vi.fn();
    const fixture = setup({
      runtime: {
        'ssh-1': runtimeEntry('connected'),
        'ssh-2': runtimeEntry('disconnected'),
      },
      onConnectionReady,
    });

    await fixture.store.start();
    expect(onConnectionReady).toHaveBeenCalledTimes(1);
    expect(onConnectionReady).toHaveBeenCalledWith('ssh-1');

    fixture.instance.states.runtime.produce((runtime) => {
      runtime['ssh-2'] = runtimeEntry('connected');
    });
    await vi.waitFor(() => expect(onConnectionReady).toHaveBeenCalledTimes(2));
    expect(onConnectionReady).toHaveBeenLastCalledWith('ssh-2');

    fixture.instance.states.runtime.produce((runtime) => {
      runtime['ssh-2'] = runtimeEntry('connected');
    });
    await Promise.resolve();
    expect(onConnectionReady).toHaveBeenCalledTimes(2);

    fixture.instance.states.runtime.produce((runtime) => {
      runtime['ssh-2'] = runtimeEntry('disconnected');
    });
    fixture.instance.states.runtime.produce((runtime) => {
      runtime['ssh-2'] = runtimeEntry('connected');
    });
    await vi.waitFor(() => expect(onConnectionReady).toHaveBeenCalledTimes(3));

    await fixture.dispose();
  });

  it('reads health and state from the merged runtime model', async () => {
    const fixture = setup();
    await fixture.store.start();

    fixture.instance.states.runtime.produce((runtime) => {
      runtime['ssh-1'] = {
        state: 'disconnected',
        health: { status: 'degraded' },
      };
    });
    await vi.waitFor(() =>
      expect(fixture.store.healthFor('ssh-1')).toEqual({ status: 'degraded' })
    );
    expect(fixture.store.stateFor('ssh-1')).toBe('disconnected');

    fixture.instance.states.runtime.produce((runtime) => {
      runtime['ssh-1']!.health = { status: 'ok' };
    });
    await vi.waitFor(() => expect(fixture.store.healthFor('ssh-1')).toEqual({ status: 'ok' }));
    expect(fixture.store.healthStates).toEqual({ 'ssh-1': { status: 'ok' } });

    await fixture.dispose();
  });

  it('allows forced connect while reconnecting', async () => {
    const fixture = setup({
      runtime: { 'ssh-1': runtimeEntry('reconnecting') },
    });
    await fixture.store.start();

    await fixture.store.connect('ssh-1');
    expect(fixture.connect).not.toHaveBeenCalled();

    await fixture.store.connect('ssh-1', { force: true });
    expect(fixture.connect).toHaveBeenCalledWith('ssh-1');
    expect(fixture.store.stateFor('ssh-1')).toBe('connected');

    await fixture.dispose();
  });

  it('routes background ensure requests through the intent-aware SSH procedure', async () => {
    const fixture = setup({
      runtime: { 'ssh-1': runtimeEntry('reconnecting') },
    });
    await fixture.store.start();

    await fixture.store.ensureConnected('ssh-1');
    expect(fixture.ensureConnected).not.toHaveBeenCalled();

    await fixture.store.ensureConnected('ssh-1', { force: true });
    expect(fixture.ensureConnected).toHaveBeenCalledWith('ssh-1');
    expect(fixture.store.stateFor('ssh-1')).toBe('connected');

    await fixture.dispose();
  });

  it('shows only server-authoritative connect and disconnect states', async () => {
    const connectGate = deferred<void>();
    const connectFixture = setup({
      runtime: { 'ssh-1': runtimeEntry('disconnected') },
      connectGate,
    });
    await connectFixture.store.start();

    const connect = connectFixture.store.connect('ssh-1');
    await vi.waitFor(() => expect(connectFixture.store.stateFor('ssh-1')).toBe('connecting'));
    expect(connectFixture.store.isLoading).toBe(false);
    connectGate.resolve();
    await connect;
    expect(connectFixture.store.stateFor('ssh-1')).toBe('connected');
    expect(connectFixture.store.isLoading).toBe(false);
    await connectFixture.dispose();

    const disconnectGate = deferred<void>();
    const disconnectFixture = setup({
      runtime: { 'ssh-1': runtimeEntry('connected') },
      disconnectGate,
    });
    await disconnectFixture.store.start();

    const disconnect = disconnectFixture.store.disconnect('ssh-1');
    await vi.waitFor(() => expect(disconnectFixture.disconnect).toHaveBeenCalled());
    expect(disconnectFixture.store.stateFor('ssh-1')).toBe('connected');
    expect(disconnectFixture.store.isLoading).toBe(false);
    disconnectGate.resolve();
    await disconnect;
    expect(disconnectFixture.store.stateFor('ssh-1')).toBe('disconnected');
    expect(disconnectFixture.store.isLoading).toBe(false);
    await disconnectFixture.dispose();
  });

  it('shows the server-authoritative error state when connect fails', async () => {
    const connectGate = deferred<void>();
    const fixture = setup({
      runtime: { 'ssh-1': runtimeEntry('disconnected') },
      connectGate,
      connectError: 'Authentication failed',
    });
    await fixture.store.start();

    const connect = fixture.store.connect('ssh-1');
    await vi.waitFor(() => expect(fixture.store.stateFor('ssh-1')).toBe('connecting'));
    connectGate.resolve();

    await expect(connect).rejects.toThrow('Authentication failed');
    expect(fixture.store.stateFor('ssh-1')).toBe('error');
    expect(fixture.store.isLoading).toBe(false);

    await fixture.dispose();
  });

  it('passes CRUD and test operations through while updating only the saved list locally', async () => {
    const fixture = setup({
      saved: [savedConnection],
      runtime: { 'ssh-1': runtimeEntry('connected') },
      removeRuntimeOnDelete: true,
    });
    await fixture.store.start();

    await fixture.store.saveConnection({
      ...savedConnection,
      name: 'Corp updated',
      sshConfigAlias: 'corp-dev',
      forwardAgent: true,
      proxyJump: 'bastion',
    });
    expect(fixture.saveMachine.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        sshConfigAlias: 'corp-dev',
        forwardAgent: true,
        proxyJump: 'bastion',
      })
    );
    expect(fixture.store.connections[0]?.name).toBe('Corp updated');

    await fixture.store.renameConnection('ssh-1', 'Renamed');
    expect(fixture.renameMachine.mock.calls[0]?.[0]).toEqual({
      id: 'ssh-1',
      name: 'Renamed',
    });
    expect(fixture.store.connections[0]?.name).toBe('Renamed');

    await expect(fixture.store.getSshConfigHosts()).resolves.toEqual([]);
    await expect(fixture.store.getSshConfigHost('corp-dev')).resolves.toMatchObject({
      host: 'corp-dev',
    });
    await expect(fixture.store.testConnection(savedConnection)).resolves.toEqual({
      success: true,
    });

    await fixture.store.deleteConnection('ssh-1');
    expect(fixture.deleteMachine.mock.calls[0]?.[0]).toEqual({ id: 'ssh-1' });
    expect(fixture.store.connections).toEqual([]);
    await vi.waitFor(() => expect(fixture.store.stateFor('ssh-1')).toBe('disconnected'));

    await fixture.dispose();
  });
});

function runtimeEntry(
  state: SshConnectionsRuntime[string]['state']
): SshConnectionsRuntime[string] {
  return { state, health: { status: 'ok' } };
}

function setup(
  options: {
    runtime?: SshConnectionsRuntime;
    saved?: SshConfig[];
    onConnectionReady?: (connectionId: string) => void;
    connectGate?: Deferred<void>;
    disconnectGate?: Deferred<void>;
    connectError?: string;
    removeRuntimeOnDelete?: boolean;
  } = {}
) {
  const connect = vi.fn(async (_connectionId: string) => {
    await options.connectGate?.promise;
    if (options.connectError) throw new Error(options.connectError);
  });
  const ensureConnected = vi.fn(async (_connectionId: string) => {});
  const disconnect = vi.fn(async (_connectionId: string) => {
    await options.disconnectGate?.promise;
  });
  const connections = createLiveModelHost(sshContract.connections);
  const instance = connections.create(undefined, { runtime: options.runtime ?? {} });
  const saveMachine = vi.fn(
    async (input: SaveMachineInput): Promise<SshConfig> => ({
      ...input,
      id: input.id ?? 'ssh-1',
    })
  );
  const renameMachine = vi.fn(async (_input: { id: string; name: string }) => {});
  const deleteMachine = vi.fn(async ({ id }: { id: string }) => {
    if (!options.removeRuntimeOnDelete) return;
    instance.states.runtime.produce((runtime) => {
      delete runtime[id];
    });
  });
  const sshWire = createTestWire(sshContract, {
    connections,
    connect: async ({ connectionId }) => {
      instance.states.runtime.produce((runtime) => {
        runtime[connectionId] = runtimeEntry('connecting');
      });
      try {
        await connect(connectionId);
      } catch (error) {
        instance.states.runtime.produce((runtime) => {
          runtime[connectionId] = runtimeEntry('error');
        });
        throw error;
      }
      instance.states.runtime.produce((runtime) => {
        runtime[connectionId] = runtimeEntry('connected');
      });
      return 'connected' as const;
    },
    ensureConnected: async ({ connectionId }) => {
      instance.states.runtime.produce((runtime) => {
        runtime[connectionId] = runtimeEntry('connecting');
      });
      await ensureConnected(connectionId);
      instance.states.runtime.produce((runtime) => {
        runtime[connectionId] = runtimeEntry('connected');
      });
      return 'connected' as const;
    },
    disconnect: async ({ connectionId }) => {
      await disconnect(connectionId);
      instance.states.runtime.produce((runtime) => {
        runtime[connectionId] = runtimeEntry('disconnected');
      });
    },
    getSshConfigHosts: async () => [],
    getSshConfigHost: async ({ alias }) => ({ host: alias }),
    testConnection: async () => ({ success: true }),
  });
  const machinesWire = createTestWire(machinesContract, {
    getMachines: async () => options.saved ?? [],
    getMachineUsage: async () => ({}),
    saveMachine,
    deleteMachine,
    renameMachine,
  });
  const store = new MachinesStore({
    sshClient: sshWire.client,
    machinesClient: machinesWire.client,
    onConnectionReady: options.onConnectionReady,
  });

  return {
    store,
    instance,
    connect,
    ensureConnected,
    disconnect,
    saveMachine,
    renameMachine,
    deleteMachine,
    async dispose() {
      store.dispose();
      await Promise.all([sshWire.dispose(), machinesWire.dispose()]);
    },
  };
}

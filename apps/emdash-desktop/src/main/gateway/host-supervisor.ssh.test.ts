import { EventEmitter } from 'node:events';
import { hostRef } from '@emdash/core/primitives/host/api';
import { createScope } from '@emdash/shared/concurrency';
import { peek } from '@emdash/wire/state';
import type { Client } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedHostConnection } from '@core/services/hosts/node/managed-host-connection';
import { SshConnectionManager } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';

class PhysicalClient extends EventEmitter {
  connect() {}
  destroy() {
    this.emit('close');
  }
  end() {
    this.emit('close');
  }
}

describe('supervisor with the production SSH generation adapter', () => {
  let fixture: ReturnType<typeof createFixture>;
  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createFixture();
  });
  afterEach(async () => {
    await fixture.scope.dispose();
    await fixture.manager.disconnectAll();
    vi.useRealTimers();
  });

  it('resume supersedes unfinished SSH establishment and rejects stale ready/close callbacks', async () => {
    const connecting = fixture.managed.connectSsh();
    await vi.advanceTimersByTimeAsync(0);
    const old = fixture.clients[0]!;
    fixture.supervisor.suspendSystem();
    fixture.supervisor.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.clients).toHaveLength(2);
    const current = fixture.clients[1]!;
    current.emit('ready');
    await connecting;
    old.emit('ready');
    old.emit('close');
    expect(fixture.manager.getProxy('host')?.client).toBe(current);
    expect(fixture.manager.isConnected('host')).toBe(true);
  });

  it('owns automatic physical recovery and stops on authentication failure', async () => {
    const connecting = fixture.managed.connectSsh();
    await vi.advanceTimersByTimeAsync(0);
    fixture.clients[0]!.emit('ready');
    await connecting;
    fixture.clients[0]!.emit('close');
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.clients).toHaveLength(2);
    fixture.clients[1]!.emit('error', new Error('All configured authentication methods failed'));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(peek(fixture.supervisor.state).kind).toBe('blocked');
    expect(fixture.clients).toHaveLength(2);
  });
});

function createFixture() {
  const scope = createScope({ label: 'supervisor-physical-ssh-test' });
  const clients: PhysicalClient[] = [];
  const manager = new SshConnectionManager({
    createClient: () => {
      const instance = new PhysicalClient();
      clients.push(instance);
      return instance as unknown as Client;
    },
  });
  const managed = new ManagedHostConnection({
    scope,
    host: hostRef('remote', 'host'),
    random: () => 0.5,
    intent: { read: async () => true, write: async () => {} },
    ssh: {
      connected: () => manager.isConnected('host'),
      establish: async (signal) => {
        await manager.createConnection(
          'host',
          async () => ({
            config: { host: 'fault.invalid', username: 'test' },
            cleanup() {},
            debugLogs: [],
          }),
          { signal }
        );
      },
      reset: () => manager.resetConnection('host'),
      probe: async () => {},
    },
    runtime: {
      prepare: async () => {
        throw new Error('SSH-only demand must not prepare runtime');
      },
      open: async () => {
        throw new Error('SSH-only demand must not open Wire');
      },
      cancel() {},
    },
  });
  const supervisor = managed.supervisor;
  manager.on('connection-event', (event) => {
    if (event.type === 'disconnected') supervisor.sshDisconnected();
  });
  return { scope, manager, clients, supervisor, managed };
}

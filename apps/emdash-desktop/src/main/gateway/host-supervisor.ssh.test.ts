import { hostRef } from '@emdash/core/primitives/host/api';
import { createScope } from '@emdash/shared/concurrency';
import { peek } from '@emdash/wire/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedHostConnection } from '@core/services/hosts/node/managed-host-connection';
import { SshConnectionManager } from '@core/services/ssh/node/lifecycle/ssh-connection-manager';
import type { SshSession } from '@core/services/ssh/node/openssh/session';
import { deferred, fakeSession } from '@core/services/ssh/node/openssh/testing/session';

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
    current.ready.resolve(current.session);
    await connecting;
    old.ready.resolve(old.session);
    old.session.lost.resolve(undefined);
    await fixture.manager.getProxy('host')?.execScript('true');
    expect(current.session.exec).toHaveBeenCalledOnce();
    expect(fixture.manager.isConnected('host')).toBe(true);
  });

  it('owns automatic physical recovery and stops on authentication failure', async () => {
    const connecting = fixture.managed.connectSsh();
    await vi.advanceTimersByTimeAsync(0);
    fixture.clients[0]!.ready.resolve(fixture.clients[0]!.session);
    await connecting;
    fixture.clients[0]!.session.lost.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.clients).toHaveLength(2);
    fixture.clients[1]!.ready.reject(new Error('All configured authentication methods failed'));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(peek(fixture.supervisor.state).kind).toBe('blocked');
    expect(fixture.clients).toHaveLength(2);
  });
});

function createFixture() {
  const scope = createScope({ label: 'supervisor-physical-ssh-test' });
  const clients: Array<{
    session: ReturnType<typeof fakeSession>;
    ready: ReturnType<typeof deferred<SshSession>>;
  }> = [];
  const manager = new SshConnectionManager({
    connectSession: () => {
      const instance = { session: fakeSession(), ready: deferred<SshSession>() };
      clients.push(instance);
      return instance.ready.promise;
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
            config: {
              destination: 'fault.invalid',
              hostname: 'fault.invalid',
              username: 'test',
              args: [],
              env: {},
              readyTimeout: 1000,
            },
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

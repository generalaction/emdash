import { describe, expect, it, vi } from 'vitest';
import { WorkspaceServerLifecycle } from './lifecycle';

describe('WorkspaceServerLifecycle', () => {
  it.each(['disconnected', 'reconnecting', 'reconnected'] as const)(
    'does not invalidate a stable session on %s',
    async (type) => {
      const fixture = createLifecycleFixture();
      const event =
        type === 'reconnecting'
          ? { type, connectionId: 'ssh-1', attempt: 1, delayMs: 1 }
          : type === 'reconnected'
            ? { type, connectionId: 'ssh-1', proxy: {} as never }
            : { type, connectionId: 'ssh-1' };

      await fixture.lifecycle.handleSshEvent(event);

      expect(fixture.drop).not.toHaveBeenCalled();
      expect(fixture.invalidateConnection).not.toHaveBeenCalled();
      expect(fixture.invalidations).toEqual([]);
    }
  );

  it('drops caches and invalidates the broker after reconnect exhaustion', async () => {
    const fixture = createLifecycleFixture();

    await fixture.lifecycle.handleSshEvent({ type: 'reconnect-failed', connectionId: 'ssh-1' });

    expect(fixture.drop).toHaveBeenCalledWith('ssh-1');
    expect(fixture.invalidateConnection).toHaveBeenCalledWith('ssh-1');
    expect(fixture.invalidations).toEqual([{ connectionId: 'ssh-1', reason: 'reconnect-failed' }]);
  });

  it('cancels ensure and invalidates every cache after a machine mutation', async () => {
    const fixture = createLifecycleFixture();

    await fixture.lifecycle.handleMachineMutation({ type: 'saved', connectionId: 'ssh-1' });

    expect(fixture.cancel).toHaveBeenCalledWith('ssh-1');
    expect(fixture.drop).toHaveBeenCalledWith('ssh-1');
    expect(fixture.invalidateConnection).toHaveBeenCalledWith('ssh-1');
    expect(fixture.invalidations).toEqual([{ connectionId: 'ssh-1', reason: 'machine-mutation' }]);
  });

  it('invalidates only the affected remote broker session on terminal client failure', () => {
    const fixture = createLifecycleFixture();
    const error = new Error('retry budget exhausted');
    const target = {
      kind: 'ssh' as const,
      sshConnectionId: 'ssh-1',
      socketPath: '/run/workspace.sock',
    };

    fixture.lifecycle.handleTerminalError(error, target);
    fixture.lifecycle.handleTerminalError(error, {
      kind: 'local-socket',
      socketPath: '/tmp/workspace.sock',
    });

    expect(fixture.invalidations).toEqual([
      {
        connectionId: 'ssh-1',
        reason: 'terminal-client',
        target,
        error,
      },
    ]);
  });

  it('continues notifying observers when one observer throws', async () => {
    const fixture = createLifecycleFixture();
    fixture.lifecycle.onInvalidate(() => {
      throw new Error('observer failed');
    });

    await expect(
      fixture.lifecycle.handleSshEvent({ type: 'reconnect-failed', connectionId: 'ssh-1' })
    ).resolves.toBeUndefined();

    expect(fixture.invalidateConnection).toHaveBeenCalledWith('ssh-1');
    expect(fixture.invalidations).toEqual([{ connectionId: 'ssh-1', reason: 'reconnect-failed' }]);
  });
});

function createLifecycleFixture() {
  const drop = vi.fn();
  const invalidateConnection = vi.fn(async () => {});
  const cancel = vi.fn(async () => {});
  const lifecycle = new WorkspaceServerLifecycle({
    host: { drop },
    connections: { invalidateConnection },
    provisioner: { cancel },
  });
  const invalidations: unknown[] = [];
  lifecycle.onInvalidate((event) => invalidations.push(event));
  return { lifecycle, drop, invalidateConnection, cancel, invalidations };
}

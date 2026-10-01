import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SshConnectResult } from '../connect/resolve-ssh-connect-config';
import type { SshSession } from '../openssh/session';
import { deferred, fakeSession } from '../openssh/testing/session';
import { SshConnectionManager } from './ssh-connection-manager';
const resolved: SshConnectResult = {
  config: {
    destination: 'example',
    hostname: 'example',
    username: 'alice',
    args: [],
    env: {},
    readyTimeout: 100,
  },
  debugLogs: [],
};
const managers: SshConnectionManager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.disconnectAll();
  vi.useRealTimers();
});
function fixture() {
  const session = fakeSession();
  const connectSession = vi.fn(async () => session);
  const publishEvent = vi.fn();
  const manager = new SshConnectionManager({ connectSession, publishEvent });
  managers.push(manager);
  return { manager, session, connectSession, publishEvent };
}

describe('SSH connection generations', () => {
  it('coalesces a reentrant connect from a connecting event listener', async () => {
    const f = fixture();
    const resolve = vi.fn(async () => resolved);
    let reentrant: Promise<unknown> | undefined;
    f.manager.once('connection-event', () => {
      reentrant = f.manager.createConnection('host', resolve);
    });
    const proxy = await f.manager.createConnection('host', resolve);
    expect(await reentrant).toBe(proxy);
    expect(f.connectSession).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
  });
  it('establishes once and reuses the logical proxy', async () => {
    const f = fixture();
    const resolve = vi.fn(async () => resolved);
    const [one, two] = await Promise.all([
      f.manager.createConnection('host', resolve),
      f.manager.createConnection('host', resolve),
    ]);
    expect(one).toBe(two);
    expect(resolve).toHaveBeenCalledOnce();
    expect(f.connectSession).toHaveBeenCalledOnce();
    expect(f.manager.getConnectionState('host')).toBe('connected');
    expect(f.publishEvent.mock.calls.map(([event]) => event.type)).toEqual([
      'connecting',
      'connected',
    ]);
  });
  it('does not publish ephemeral connection tests', async () => {
    const f = fixture();
    await f.manager.createConnection('test', async () => resolved, { ephemeral: true });
    await f.manager.dropConnection('test');
    expect(f.publishEvent).not.toHaveBeenCalled();
    expect(f.manager.getConnectionIds()).toEqual([]);
  });
  it('does not start an already cancelled connection', async () => {
    const f = fixture();
    await expect(
      f.manager.createConnection('host', async () => resolved, {
        signal: AbortSignal.abort(new Error('cancelled')),
      })
    ).rejects.toThrow('cancelled');
    expect(f.connectSession).not.toHaveBeenCalled();
  });
  it('closes a session that finishes after reset', async () => {
    const f = fixture();
    const pending = deferred<SshSession>();
    f.connectSession.mockImplementationOnce(
      () => pending.promise as Promise<ReturnType<typeof fakeSession>>
    );
    const connecting = f.manager.createConnection('host', async () => resolved);
    const rejected = expect(connecting).rejects.toThrow();
    await vi.waitFor(() => expect(f.connectSession).toHaveBeenCalledOnce());
    f.manager.resetConnection('host');
    await rejected;
    pending.resolve(f.session);
    await vi.waitFor(() => expect(f.session.close).toHaveBeenCalledOnce());
    expect(f.manager.isConnected('host')).toBe(false);
  });
  it('never lets an old session close invalidate its replacement', async () => {
    const f = fixture();
    const proxy = await f.manager.createConnection('host', async () => resolved);
    f.manager.resetConnection('host');
    const next = fakeSession();
    f.connectSession.mockResolvedValueOnce(next);
    expect(await f.manager.createConnection('host', async () => resolved)).toBe(proxy);
    f.session.lost.resolve(new Error('late close'));
    await Promise.resolve();
    expect(proxy.isConnected).toBe(true);
    expect(f.publishEvent.mock.calls.at(-1)?.[0].type).toBe('reconnected');
  });
  it('publishes loss once and leaves reconnection to the host supervisor', async () => {
    const f = fixture();
    await f.manager.createConnection('host', async () => resolved);
    f.session.lost.resolve(new Error('network lost'));
    await vi.waitFor(() => expect(f.manager.isConnected('host')).toBe(false));
    expect(
      f.publishEvent.mock.calls.filter(([event]) => event.type === 'disconnected')
    ).toHaveLength(1);
    expect(f.connectSession).toHaveBeenCalledOnce();
  });
  it.each([
    ['Permission denied (publickey)', 'authentication'],
    ['Host key verification failed', 'host-key'],
    ['Connection timed out', 'timeout'],
    ['Connection refused', 'transport'],
  ])('classifies %s as %s', async (message, kind) => {
    const f = fixture();
    f.connectSession.mockRejectedValueOnce(new Error(message));
    await expect(f.manager.createConnection('host', async () => resolved)).rejects.toMatchObject({
      kind,
      message,
    });
    expect(f.manager.getConnectionState('host')).toBe('disconnected');
  });
  it('starts a new logical identity after a connection is dropped', async () => {
    const f = fixture();
    const before = await f.manager.createConnection('host', async () => resolved);
    await f.manager.dropConnection('host');
    f.connectSession.mockResolvedValueOnce(fakeSession());
    const after = await f.manager.createConnection('host', async () => resolved);
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
  });
  it('cancels operations on the generation on which they started', async () => {
    const f = fixture();
    f.session.exec = vi.fn<SshSession['exec']>(
      (_command, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          });
        })
    );
    const proxy = await f.manager.createConnection('host', async () => resolved);
    const exec = proxy.execScript('sleep 10');
    const rejected = expect(exec).rejects.toThrow();
    f.manager.resetConnection('host');
    await rejected;
  });
});

it('never starts the transport if config resolution completes after cancellation', async () => {
  const f = fixture();
  const config = deferred<SshConnectResult>();
  const pending = f.manager.createConnection('host', () => config.promise);
  const rejected = expect(pending).rejects.toThrow();
  f.manager.resetConnection('host');
  await rejected;
  config.resolve(resolved);
  await Promise.resolve();
  expect(f.connectSession).not.toHaveBeenCalled();
});

it('bounds authentication and cleans up a session returned after the deadline', async () => {
  const f = fixture();
  const session = deferred<SshSession>();
  f.connectSession.mockImplementationOnce(
    () => session.promise as Promise<ReturnType<typeof fakeSession>>
  );
  await expect(
    f.manager.createConnection('host', async () => ({
      ...resolved,
      config: { ...resolved.config, readyTimeout: 10 },
    }))
  ).rejects.toMatchObject({ kind: 'timeout' });
  session.resolve(f.session);
  await vi.waitFor(() => expect(f.session.close).toHaveBeenCalledOnce());
  expect(f.manager.isConnected('host')).toBe(false);
});

it('allows trust review beyond the acquisition budget and still cancels on disconnect', async () => {
  vi.useFakeTimers();
  const ready = deferred<void>();
  const approved = deferred<SshSession>();
  const manager = new SshConnectionManager({
    connectSession: async (_config, { interaction }) => {
      const resume = interaction.begin();
      ready.resolve();
      try {
        return await approved.promise;
      } finally {
        resume();
      }
    },
  });
  managers.push(manager);
  const pending = manager.createConnection('host', async () => resolved);
  await ready.promise;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(manager.getConnectionState('host')).toBe('connecting');
  const rejected = expect(pending).rejects.toThrow('SSH connection closed');
  manager.resetConnection('host');
  await rejected;
  const session = fakeSession();
  approved.resolve(session);
  await vi.advanceTimersByTimeAsync(0);
  expect(session.close).toHaveBeenCalledOnce();
});

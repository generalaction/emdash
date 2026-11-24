import { createScope, type Scope } from '@emdash/shared/concurrency';
import { systemClock } from '@emdash/shared/scheduling';
import { client } from '@emdash/wire/rpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostRuntimeConnection } from './host-runtime-connection';
import {
  createFaultPeer,
  observePromise,
  peerContract,
} from './testing/connection-supervisor-fixture';

const target = { kind: 'ssh' as const, sshConnectionId: 'test', socketPath: '/workspace.sock' };

describe('HostRuntimeConnection', () => {
  let scope: Scope;
  let peer: ReturnType<typeof createFaultPeer>;
  let runtime: HostRuntimeConnection;
  let afterMessage: (() => void) | undefined;
  const activityListeners = new Set<() => void>();
  const emitActivity = () => {
    for (const listener of activityListeners) listener();
  };
  const onDisconnect = vi.fn();
  const onRequestTimeout = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onDisconnect.mockClear();
    onRequestTimeout.mockClear();
    afterMessage = undefined;
    activityListeners.clear();
    scope = createScope({ label: 'runtime-connection-test' });
    peer = createFaultPeer();
    runtime = new HostRuntimeConnection({
      scope,
      clock: systemClock,
      open: async () => {
        const transport = await peer.openTransport();
        return {
          ...transport,
          onMessage: (listener) =>
            transport.onMessage((message) => {
              listener(message);
              afterMessage?.();
            }),
          onActivity: (listener) => {
            activityListeners.add(listener);
            return () => activityListeners.delete(listener);
          },
        };
      },
      openTimeoutMs: 100,
      initializeTimeoutMs: 100,
      healthTimeoutMs: 50,
      onDisconnect,
      onRequestTimeout,
    });
  });

  afterEach(async () => {
    try {
      afterMessage = undefined;
      await scope.dispose();
      await peer.dispose();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the logical connection and client while replacing the initialized transport', async () => {
    const connection = runtime.connection;
    const client = runtime.client;
    const attempt = scope.child('attempt');
    await runtime.establish(target, attempt.signal);
    await attempt.dispose();
    expect(runtime.connected).toBe(true);
    expect(runtime.currentHandshake?.server.daemonId).toBe('daemon-1');
    await runtime.probe(scope.signal);
    const first = peer.current;
    const generation = runtime.generation;
    runtime.detach();
    expect(first.closed).toBe(true);
    expect(runtime.currentHandshake).toBeUndefined();
    await expect(client.health(undefined)).rejects.toMatchObject({ code: 'DISCONNECTED' });
    peer.setDaemonId('daemon-2');
    await runtime.establish(target, scope.signal);
    expect(runtime.connection).toBe(connection);
    expect(runtime.client).toBe(client);
    expect(runtime.generation).toBeGreaterThan(generation);
    expect(runtime.currentHandshake?.server.daemonId).toBe('daemon-2');
    runtime.detach(generation);
    expect(runtime.connected).toBe(true);
    await expect(client.health(undefined)).resolves.toMatchObject({ status: 'ok' });
  });

  it.each(['open', 'initialize'] as const)(
    'bounds %s and disposes late resources without retrying',
    async (phase) => {
      const release = phase === 'open' ? peer.stallOpen() : peer.stallInitialize();
      const rejected = expect(runtime.establish(target, scope.signal)).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(101);
      await rejected;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(runtime.connected).toBe(false);
      expect(peer.current.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(peer.opens).toBe(1);
    }
  );

  describe.each(['open', 'initialize'] as const)('pending %s', (phase) => {
    it.each(['caller', 'detach', 'dispose'] as const)('is revoked by %s', async (cause) => {
      const release = phase === 'open' ? peer.stallOpen() : peer.stallInitialize();
      const caller = new AbortController();
      const rejected = expect(runtime.establish(target, caller.signal)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      if (cause === 'caller') caller.abort();
      else if (cause === 'detach') runtime.detach();
      else await runtime.dispose();
      await rejected;
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.current.closed).toBe(true);
      expect(runtime.connected).toBe(false);
      expect(runtime.currentHandshake).toBeUndefined();
    });
  });

  it('does not install an older attempt after a newer attempt succeeds', async () => {
    const release = peer.stallInitialize();
    const stale = expect(runtime.establish(target, scope.signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    const old = peer.current;
    release();
    peer.setDaemonId('daemon-2');
    await runtime.establish(target, scope.signal);
    await stale;
    expect(old.closed).toBe(true);
    expect(runtime.currentHandshake?.server.daemonId).toBe('daemon-2');
  });

  it('rejects health success if its transport was detached before the continuation runs', async () => {
    await runtime.establish(target, scope.signal);
    // Deliver success, then revoke the physical generation before its promise resumes.
    afterMessage = () => {
      afterMessage = undefined;
      queueMicrotask(() => runtime.detach());
    };
    await expect(runtime.probe(scope.signal)).rejects.toThrow('Superseded health response');
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('accepts a late health reply while the transport keeps delivering other traffic', async () => {
    // A busy host streams megabytes after each reconnect; the health reply queues behind that
    // ordered traffic. Messages still arriving on the probed transport prove it is alive, so a
    // slow reply must not be reported as a dead connection (which would reconnect and re-trigger
    // the same burst, forever).
    await runtime.establish(target, scope.signal);
    const releaseHealth = peer.stallHealth();
    const probe = observePromise(runtime.probe(scope.signal));
    const traffic = client(peerContract, runtime.connection);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(20);
      await traffic.increment();
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(probe.outcome).toBe('fulfilled');
    releaseHealth();
  });

  it('accepts a late health reply while one large frame is still arriving', async () => {
    // On a slow link a single multi-megabyte frame (a resync snapshot) can take longer than the
    // health deadline to complete. No whole message arrives meanwhile, but bytes do.
    await runtime.establish(target, scope.signal);
    const releaseHealth = peer.stallHealth();
    const probe = observePromise(runtime.probe(scope.signal));
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(20);
      emitActivity();
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(probe.outcome).toBe('fulfilled');
    expect(activityListeners.size).toBe(0);
    releaseHealth();
  });

  it('still fails the probe when nothing arrives on the transport', async () => {
    await runtime.establish(target, scope.signal);
    const releaseHealth = peer.stallHealth();
    const rejected = expect(runtime.probe(scope.signal)).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    releaseHealth();
  });

  it('reports RPC timeouts without deciding to replace or retry the connection', async () => {
    await runtime.establish(target, scope.signal);
    peer.current.dropReplies = true;
    const rejected = expect(
      runtime.client.health(undefined, { timeoutMs: 50 })
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(onRequestTimeout).toHaveBeenCalledOnce();
    expect(runtime.connected).toBe(true);
    expect(peer.opens).toBe(1);
  });
});

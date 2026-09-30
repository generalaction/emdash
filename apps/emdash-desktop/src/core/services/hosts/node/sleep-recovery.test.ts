import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFaultPeer, createSupervisorDriver } from './testing/connection-supervisor-fixture';

describe('sleep recovery', () => {
  afterEach(() => vi.useRealTimers());

  it.each([true, false])('measures resume when SSH is silently dead: %s', async (deadSsh) => {
    vi.useFakeTimers();
    const peer = createFaultPeer();
    let reportedConnected = true;
    let deadPhysicalConnection = false;
    const reset = vi.fn(() => {
      reportedConnected = false;
    });
    const host = createSupervisorDriver(peer, {
      ssh: {
        connected: () => reportedConnected,
        establish: async () => {
          if (!reportedConnected) {
            reportedConnected = true;
            deadPhysicalConnection = false;
          }
        },
        reset,
        probe: () => (deadPhysicalConnection ? new Promise<void>(() => {}) : Promise.resolve()),
      },
      runtime: {
        prepare: async () => ({
          kind: 'ssh',
          sshConnectionId: 'acceptance-host',
          socketPath: '/workspace.sock',
        }),
        open: () => (deadPhysicalConnection ? new Promise(() => {}) : peer.openTransport()),
        cancel() {},
      },
    });
    try {
      await host.connect();
      deadPhysicalConnection = deadSsh;
      peer.current.dropRequests = true;
      host.supervisor.suspendSystem();
      host.supervisor.resume();
      await vi.advanceTimersByTimeAsync(5_000);
      if (!deadSsh) {
        expect(host.state.kind).toBe('ready');
        expect(reset).not.toHaveBeenCalled();
        expect(peer.opens).toBe(2);
        return;
      }
      expect(reset).toHaveBeenCalledOnce();
      expect(host.state.kind).toBe('ready');
      expect(peer.opens).toBe(2);
    } finally {
      await host.dispose();
      await peer.dispose();
    }
  });

  it.each(['online', 'retry'] as const)(
    'compares %s during scheduled recovery backoff',
    async (cause) => {
      vi.useFakeTimers();
      const peer = createFaultPeer();
      const host = createSupervisorDriver(peer);
      try {
        await host.connect();
        peer.setOffline(true);
        peer.current.disconnect();
        await vi.advanceTimersByTimeAsync(68_500);
        expect(host.state).toMatchObject({ kind: 'unavailable', recovery: 'waiting' });
        const attempts = peer.opens;
        const state = host.state;
        if (state.kind !== 'unavailable' || state.nextAttemptAt === undefined)
          throw new Error('missing retry');
        const remaining = state.nextAttemptAt - Date.now();
        expect(remaining).toBe(30_000);
        peer.setOffline(false);
        if (cause === 'retry') {
          host.retry();
        } else {
          host.revalidate('online');
          host.revalidate('focus');
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(peer.opens).toBe(attempts + 1);
        expect(host.state.kind).toBe('ready');
      } finally {
        await host.dispose();
        await peer.dispose();
      }
    }
  );
});

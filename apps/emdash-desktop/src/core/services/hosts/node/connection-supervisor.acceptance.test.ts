import { remote, snapshot } from '@emdash/wire/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSupervisorDriver,
  createFaultPeer,
  observePromise,
  peerContract,
  resourceClient,
} from './testing/connection-supervisor-fixture';

// Production supervisor and Wire, driven through faulting boundary adapters.

describe('Host connection supervisor acceptance (ADR 0008)', () => {
  let peer: ReturnType<typeof createFaultPeer>;
  let host: ReturnType<typeof createSupervisorDriver>;

  beforeEach(() => {
    vi.useFakeTimers();
    peer = createFaultPeer();
    host = createSupervisorDriver(peer);
  });

  afterEach(async () => {
    try {
      const disposing = host.dispose();
      await peer.dispose();
      await vi.advanceTimersByTimeAsync(0);
      await disposing;
    } finally {
      vi.useRealTimers();
    }
  });

  it('establishes a usable attachment through a real initialize and health exchange', async () => {
    const connected = host.connect();
    await vi.advanceTimersByTimeAsync(0);
    await expect(connected).resolves.toMatchObject({ success: true });
    const attachment = await host.getAttachment();
    await expect(attachment.client.health(undefined)).resolves.toMatchObject({ status: 'ok' });
    expect(host.state.kind).toBe('ready');
    await expect(host.getAttachment()).resolves.toBe(attachment);
  });

  it('does not publish readiness when the installed transport closes before establishment returns', async () => {
    const open = peer.openTransport;
    const spy = vi.spyOn(peer, 'openTransport').mockImplementation(async () => {
      const transport = await open();
      let subscriptions = 0;
      return {
        ...transport,
        onDisconnect(listener) {
          const unsubscribe = transport.onDisconnect(listener);
          // First subscription belongs to initialize; the next installs the physical transport.
          if (++subscriptions === 2) queueMicrotask(() => transport.close?.());
          return unsubscribe;
        },
      };
    });
    try {
      const connected = host.connect();
      const outcome = observePromise(connected);
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.current.closed).toBe(true);
      expect(host.state.kind).not.toBe('ready');
      expect(outcome.outcome).toBe('pending');
      await host.disconnect();
      await connected;
    } finally {
      spy.mockRestore();
    }
  });

  it('releases the installed transport when readiness publication fails', async () => {
    await host.dispose();
    host = createSupervisorDriver(peer, {
      onReady: () => {
        throw new Error('readiness listener failed');
      },
    });
    const connected = host.connect();
    const outcome = observePromise(connected);
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.current.closed).toBe(true);
    expect(host.state.kind).not.toBe('ready');
    expect(outcome.outcome).toBe('pending');
    await host.disconnect();
    await connected;
  });

  describe('previously ready attachment', () => {
    beforeEach(async () => {
      const connected = host.connect();
      await vi.advanceTimersByTimeAsync(0);
      await expect(connected).resolves.toMatchObject({ success: true });
      const attachment = await host.getAttachment();
      await expect(attachment.client.health(undefined)).resolves.toMatchObject({ status: 'ok' });
    });

    it('demotes a silent blackhole within the validation budget without a close event', async () => {
      peer.current.dropRequests = true;
      peer.setOffline(true);

      await vi.advanceTimersByTimeAsync(20_001);

      expect(host.state.kind).not.toBe('ready');
    });

    for (const cause of ['online', 'focus'] as const) {
      it(`${cause} revalidates a previously ready attachment`, async () => {
        peer.current.dropReplies = true;
        peer.setOffline(true);

        host.revalidate(cause);
        await vi.advanceTimersByTimeAsync(5_001);

        expect(host.state.kind).not.toBe('ready');
      });
    }

    it('injects a lost response without producing a transport disconnect', async () => {
      const attachment = await host.getAttachment();
      let disconnected = false;
      const unsubscribe = attachment.connection.onDisconnect(() => {
        disconnected = true;
      });
      peer.current.dropReplies = true;
      const result = attachment.client.health(undefined, { timeoutMs: 5_000 });
      const rejected = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });

      await vi.advanceTimersByTimeAsync(5_001);

      await rejected;
      expect(disconnected).toBe(false);
      expect(peer.current.closed).toBe(false);
      unsubscribe();
    });

    it('awaitUsable waits for replacement initialization while the attachment stays stable', async () => {
      const attachment = await host.getAttachment();
      const release = peer.stallInitialize();
      peer.current.disconnect();
      await vi.advanceTimersByTimeAsync(0);
      const currentReadiness = observePromise(attachment.ready());
      const usable = observePromise(host.awaitUsable());
      await vi.advanceTimersByTimeAsync(0);
      try {
        expect(currentReadiness.outcome).toBe('pending');
        await expect(host.getAttachment()).resolves.toBe(attachment);
        expect(usable.outcome).toBe('pending');
      } finally {
        release();
      }
    });

    it('an explicit close demotes availability throughout replacement initialization', async () => {
      const release = peer.stallInitialize();
      peer.current.disconnect();
      await vi.advanceTimersByTimeAsync(0);
      try {
        expect(host.state.kind).not.toBe('ready');
      } finally {
        release();
      }
    });

    it('a stalled channel opening cannot monopolize recovery indefinitely', async () => {
      const release = peer.stallOpen();
      peer.current.disconnect();
      await vi.advanceTimersByTimeAsync(0);
      const firstReplacementAttempt = peer.opens;
      try {
        await vi.advanceTimersByTimeAsync(35_000);
        expect(peer.opens).toBeGreaterThan(firstReplacementAttempt);
      } finally {
        release();
      }
    });

    it('explicit Retry validates even when cached availability is ready', async () => {
      peer.current.dropRequests = true;
      peer.setOffline(true);

      host.retry();
      await vi.advanceTimersByTimeAsync(5_001);

      expect(host.state.kind).not.toBe('ready');
    });

    it('preserves logical identity across an outage longer than the old retry budgets', async () => {
      const attachment = await host.getAttachment();
      peer.setOffline(true);
      peer.current.disconnect();

      await vi.advanceTimersByTimeAsync(600_000);
      peer.setOffline(false);
      host.retry();
      await vi.advanceTimersByTimeAsync(30_000);

      expect((await host.getAttachment()) === attachment, 'logical attachment identity').toBe(true);
    });

    it('resynchronizes a retained subscription after reconnecting to a new daemon', async () => {
      const attachment = await host.getAttachment();
      const model = remote(peerContract.observation, resourceClient(attachment).observation);
      const value = model(undefined).states.value;
      try {
        await value.refresh();
        expect(snapshot(value).value).toBe(0);
        peer.setOffline(true);
        peer.current.disconnect();
        await vi.advanceTimersByTimeAsync(0);
        peer.observation.set(7);
        peer.setDaemonId('daemon-2');
        peer.setOffline(false);
        await vi.advanceTimersByTimeAsync(500);

        await expect(host.getAttachment()).resolves.toBe(attachment);
        await expect(attachment.ready()).resolves.toMatchObject({
          server: { daemonId: 'daemon-2' },
        });
        expect(snapshot(value).value).toBe(7);
      } finally {
        await model.dispose();
      }
    });

    it('does not replay a remote operation whose response was lost', async () => {
      const attachment = await host.getAttachment();
      const resource = resourceClient(attachment);
      peer.current.dropReplies = true;
      const increment = resource.increment(undefined, { timeoutMs: 5_000 });
      const rejected = expect(increment).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.executions).toBe(1);
      await vi.advanceTimersByTimeAsync(5_001);
      await rejected;

      peer.current.disconnect();
      await vi.advanceTimersByTimeAsync(0);

      await attachment.ready();
      expect(peer.executions).toBe(1);
      await expect(resource.increment(undefined)).resolves.toBe(2);
    });

    it('Disconnect suppresses existing retry timers and subsequent browser wakeups', async () => {
      peer.setOffline(true);
      peer.current.disconnect();
      await vi.advanceTimersByTimeAsync(0);

      await host.disconnect();
      const opensAtDisconnect = peer.opens;
      peer.setOffline(false);
      host.revalidate('online');
      host.revalidate('focus');
      await vi.advanceTimersByTimeAsync(600_000);

      expect(host.state.kind).toBe('suspended');
      expect(peer.opens).toBe(opensAtDisconnect);
      expect(peer.channels.every((channel) => channel.closed)).toBe(true);
    });

    it('closes a late channel returned after Disconnect', async () => {
      const release = peer.stallOpen();
      peer.current.disconnect();
      await vi.advanceTimersByTimeAsync(0);

      await host.disconnect();
      release();
      await vi.advanceTimersByTimeAsync(0);

      expect(peer.channels).toHaveLength(2);
      expect(peer.channels.every((channel) => channel.closed)).toBe(true);
      expect(host.state.kind).toBe('suspended');
    });
  });

  it('does not publish ready before the initial initialize response', async () => {
    const release = peer.stallInitialize();
    const connected = host.connect();
    const outcome = observePromise(connected);
    await vi.advanceTimersByTimeAsync(0);

    expect(peer.initializations).toBe(1);
    expect(outcome.outcome).toBe('pending');
    expect(host.state.kind).not.toBe('ready');
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(connected).resolves.toMatchObject({ success: true });
  });

  it('rejects a delayed successful initialization after Disconnect', async () => {
    const release = peer.stallInitialize();
    const connected = host.connect();
    await vi.advanceTimersByTimeAsync(0);

    const disconnected = host.disconnect();
    release();
    await vi.advanceTimersByTimeAsync(0);
    await disconnected;

    await expect(connected).resolves.toMatchObject({ success: false });
    expect(host.state.kind).toBe('suspended');
    expect(peer.channels.every((channel) => channel.closed)).toBe(true);
  });

  it('Disconnect settles without waiting for the remote initialize response', async () => {
    const release = peer.stallInitialize();
    const connected = host.connect();
    await vi.advanceTimersByTimeAsync(0);
    const disconnected = host.disconnect();
    const outcome = observePromise(disconnected);
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(outcome.outcome).toBe('fulfilled');
    } finally {
      release();
      await vi.advanceTimersByTimeAsync(0);
      await disconnected;
      await connected;
    }
  });

  it('coalesces simultaneous connect, demand, and browser wakeups into one attachment', async () => {
    const release = peer.stallInitialize();
    const first = host.connect();
    const second = host.connect();
    host.revalidate('online');
    host.revalidate('focus');
    await vi.advanceTimersByTimeAsync(0);

    expect(peer.opens).toBe(1);
    expect(peer.initializations).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(second).resolves.toMatchObject({ success: true });
  });

  it('stops automatic recovery for an incompatible protocol', async () => {
    peer.setProtocolVersion('999.0.0');
    const connected = host.connect();
    await vi.advanceTimersByTimeAsync(0);

    await expect(connected).resolves.toMatchObject({ success: false });
    expect(host.state).toMatchObject({ kind: 'unavailable', recovery: 'blocked' });
    const opensWhenBlocked = peer.opens;
    host.revalidate('online');
    host.revalidate('focus');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(peer.opens).toBe(opensWhenBlocked);
  });
});

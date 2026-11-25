import { createScope, type Scope } from '@emdash/shared/concurrency';
import { systemClock } from '@emdash/shared/scheduling';
import type { WireTransport } from '@emdash/wire/rpc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostRuntimeConnection } from './host-runtime-connection';
import { createFaultPeer } from './testing/connection-supervisor-fixture';
import type { TransportFlow } from './workspace-server/connect/owned-stream-transport';

const target = { kind: 'ssh' as const, sshConnectionId: 'test', socketPath: '/workspace.sock' };
const MIB = 1024 * 1024;
const SLOT_MS = 50;

function createFakeFlow() {
  const listeners = new Set<(bytes: number) => void>();
  const windows: number[] = [];
  const fake = {
    windows,
    /** Every touch of the flow: subscriptions and window changes. */
    calls: 0,
    flow: {
      setReceiveWindow(bytes: number) {
        fake.calls += 1;
        windows.push(bytes);
      },
      onReceived(cb: (bytes: number) => void) {
        fake.calls += 1;
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    } satisfies TransportFlow,
    emit(bytes: number) {
      for (const listener of listeners) listener(bytes);
    },
  };
  return fake;
}

describe('HostRuntimeConnection with an interactive lane', () => {
  let scope: Scope;
  let peer: ReturnType<typeof createFaultPeer>;
  let runtime: HostRuntimeConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    scope = createScope({ label: 'runtime-lane-test' });
    peer = createFaultPeer();
    runtime = new HostRuntimeConnection({
      scope,
      clock: systemClock,
      open: () => peer.openTransport(),
      openTimeoutMs: 100,
      initializeTimeoutMs: 100,
      healthTimeoutMs: 50,
      onDisconnect: vi.fn(),
      onRequestTimeout: vi.fn(),
      interactiveLane: true,
    });
  });

  afterEach(async () => {
    try {
      await scope.dispose();
      await peer.dispose();
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens and initializes a bulk channel and a lane per physical generation', async () => {
    await runtime.establish(target, scope.signal);
    expect(peer.opens).toBe(2);
    expect(runtime.connected).toBe(true);
    await expect(runtime.client.health(undefined)).resolves.toMatchObject({ status: 'ok' });
  });

  it('probes health on the lane, so a stalled bulk channel does not fail it', async () => {
    await runtime.establish(target, scope.signal);
    const [bulk, lane] = peer.channels;
    bulk!.dropReplies = true;
    await expect(runtime.probe(scope.signal)).resolves.toBeUndefined();

    lane!.dropReplies = true;
    const probe = runtime.probe(scope.signal);
    const settled = expect(probe).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(60);
    await settled;
  });

  it('holds input typed while detached and sends it after the lane is back', async () => {
    await runtime.establish(target, scope.signal);
    runtime.detach();
    const sent = runtime.client.tuiAgents.sendInput({ conversationId: 'c1', data: 'a' });
    let settled = false;
    void sent.then(
      () => (settled = true),
      () => (settled = true)
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await runtime.establish(target, scope.signal);
    // The test peer has no TUI runtime: reaching it proves the held key was replayed.
    await expect(sent).rejects.toMatchObject({ code: 'UNKNOWN_PROCEDURE' });
  });

  it.each([
    ['daemon identity', () => peer.setDaemonId('daemon-2')],
    ['protocol minor', () => peer.setProtocolVersion('12.2.0')],
  ])('refuses to install channels that disagree on %s', async (_name, change) => {
    let opens = 0;
    runtime = new HostRuntimeConnection({
      scope,
      clock: systemClock,
      open: () => {
        // The second channel reaches a changed server.
        if (++opens === 2) change();
        return peer.openTransport();
      },
      openTimeoutMs: 100,
      initializeTimeoutMs: 100,
      healthTimeoutMs: 50,
      onDisconnect: vi.fn(),
      onRequestTimeout: vi.fn(),
      interactiveLane: true,
    });
    await expect(runtime.establish(target, scope.signal)).rejects.toThrow(
      'different daemon incarnations'
    );
    expect(runtime.connected).toBe(false);
    expect(peer.channels.map((channel) => channel.closed)).toEqual([true, true]);
  });

  it('detaches both channels together', async () => {
    await runtime.establish(target, scope.signal);
    runtime.detach();
    expect(peer.channels.map((channel) => channel.closed)).toEqual([true, true]);
    expect(runtime.connected).toBe(false);
  });

  describe('adaptive bulk window', () => {
    /** Establishes with a fake flow on the bulk channel; counts messages posted on the lane. */
    async function establishTuned(adaptiveBulkWindow: boolean) {
      const fake = createFakeFlow();
      const lane = { posts: 0 };
      let opens = 0;
      runtime = new HostRuntimeConnection({
        scope,
        clock: systemClock,
        open: async (): Promise<WireTransport & { flow?: TransportFlow }> => {
          const isBulk = opens++ === 0;
          const transport = await peer.openTransport();
          if (isBulk) return { ...transport, flow: fake.flow };
          return {
            ...transport,
            post(...args: Parameters<WireTransport['post']>) {
              lane.posts += 1;
              transport.post(...args);
            },
          };
        },
        openTimeoutMs: 100,
        initializeTimeoutMs: 100,
        healthTimeoutMs: 50,
        onDisconnect: vi.fn(),
        onRequestTimeout: vi.fn(),
        interactiveLane: true,
        adaptiveBulkWindow,
      });
      // Put probe ticks in the middle of a received-bytes slot, so bytes emitted just before a
      // tick count as received in the same slot as the sample.
      await vi.advanceTimersByTimeAsync(
        (SLOT_MS / 2 - (systemClock.now() % SLOT_MS) + SLOT_MS) % SLOT_MS
      );
      await runtime.establish(target, scope.signal);
      lane.posts = 0;
      fake.calls = 0;
      return { fake, lane };
    }

    /** Emits bulk bytes one millisecond before the next probe tick, then lets the tick run. */
    async function receiveBeforeTick(fake: ReturnType<typeof createFakeFlow>) {
      await vi.advanceTimersByTimeAsync(199);
      fake.emit(8 * MIB);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
    }

    it('probes the lane while bulk bytes arrive and grows the window', async () => {
      const { fake, lane } = await establishTuned(true);
      for (let round = 0; round < 3; round += 1) await receiveBeforeTick(fake);

      expect(lane.posts).toBeGreaterThan(0);
      expect(fake.windows.length).toBeGreaterThan(1);
      expect(fake.windows[0]).toBeGreaterThan(2 * MIB);
      expect(fake.windows[1]).toBeGreaterThan(fake.windows[0]!);
    });

    it('neither probes nor resizes when no bulk bytes arrive', async () => {
      const { fake, lane } = await establishTuned(true);
      await vi.advanceTimersByTimeAsync(2000);

      expect(lane.posts).toBe(0);
      expect(fake.windows).toEqual([]);
    });

    it('stops probing and resizing after detach', async () => {
      const { fake, lane } = await establishTuned(true);
      await receiveBeforeTick(fake);
      expect(fake.windows.length).toBeGreaterThan(0);

      runtime.detach();
      const posts = lane.posts;
      const windows = fake.windows.length;
      fake.emit(8 * MIB);
      await vi.advanceTimersByTimeAsync(2000);

      expect(lane.posts).toBe(posts);
      expect(fake.windows.length).toBe(windows);
    });

    it('never touches the flow when the option is off', async () => {
      const { fake, lane } = await establishTuned(false);
      for (let round = 0; round < 3; round += 1) await receiveBeforeTick(fake);

      expect(fake.calls).toBe(0);
      expect(lane.posts).toBe(0);
    });
  });
});

import type { Unsubscribe } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { LiveLogSource } from '../live/log/source';
import { ReplicaLog } from '../live/replica/log';
import type { LiveUpdate } from './channel';
import { connect } from './connect';
import type { Controller } from './controller';
import { isWireMessage, WireError, type WireMessage, type WireTransport } from './protocol';
import { serve } from './serve';

const topic = 'T';
const u1 = { version: 1 } as unknown as LiveUpdate;
const u2 = { version: 2 } as unknown as LiveUpdate;

type Subscription = {
  push(update: LiveUpdate): void;
  onGap(): void;
  onError(error: WireError, context: { retrying: boolean }): void;
  signal?: AbortSignal;
  active: boolean;
};

type Direction = {
  held: boolean;
  queue: WireMessage[];
  sent: WireMessage[];
  post(message: WireMessage): void;
  flush(): void;
};

function direction(deliver: (message: WireMessage) => void): Direction {
  return {
    held: false,
    queue: [],
    sent: [],
    post(message) {
      this.sent.push(message);
      if (this.held) this.queue.push(message);
      else deliver(message);
    },
    flush() {
      this.held = false;
      while (this.queue.length > 0) deliver(this.queue.shift()!);
    },
  };
}

function transportPair() {
  let connected = true;
  let deliverToClient: (message: WireMessage) => void = () => {};
  let deliverToServer: (message: WireMessage) => void = () => {};
  const clientToServer = direction((message) => deliverToServer(message));
  const serverToClient = direction((message) => deliverToClient(message));

  function endpoint(outgoing: Direction) {
    const messages = new Set<(message: WireMessage) => void>();
    const disconnects = new Set<() => void>();
    const reconnects = new Set<() => void>();
    const transport: WireTransport = {
      post(message) {
        if (!connected) throw new Error('Transport disconnected');
        outgoing.post(message);
      },
      onMessage(cb) {
        messages.add(cb);
        return () => messages.delete(cb);
      },
      onDisconnect(cb) {
        disconnects.add(cb);
        return () => disconnects.delete(cb);
      },
      onReconnect(cb) {
        reconnects.add(cb);
        return () => reconnects.delete(cb);
      },
    };
    return {
      transport,
      deliver(message: WireMessage) {
        for (const cb of messages) cb(message);
      },
      disconnect() {
        for (const cb of disconnects) cb();
      },
      reconnect() {
        for (const cb of reconnects) cb();
      },
    };
  }

  const client = endpoint(clientToServer);
  const server = endpoint(serverToClient);
  deliverToClient = client.deliver;
  deliverToServer = server.deliver;
  return {
    client: client.transport,
    server: server.transport,
    clientToServer,
    serverToClient,
    disconnect() {
      connected = false;
      client.disconnect();
      server.disconnect();
    },
    reconnect() {
      connected = true;
      client.reconnect();
      server.reconnect();
    },
  };
}

function harness() {
  const pair = transportPair();
  const subscriptions: Subscription[] = [];
  const source = {
    snapshot: async () => ({}),
    subscribe: async (
      push: Subscription['push'],
      options: {
        onGap: Subscription['onGap'];
        onError: Subscription['onError'];
        signal?: AbortSignal;
      }
    ): Promise<Unsubscribe> => {
      const subscription: Subscription = { push, ...options, active: true };
      subscriptions.push(subscription);
      return () => {
        subscription.active = false;
      };
    },
  };
  const controller = {
    call: async () => 'ok',
    acquireLive: () => ({ ready: async () => source, release: async () => {} }),
  } as unknown as Controller;
  const stop = serve(pair.server, controller);
  const connection = connect(pair.client, { callTimeoutMs: 0 });
  return {
    pair,
    subscriptions,
    connection,
    close() {
      connection.dispose();
      stop();
    },
  };
}

type Harness = ReturnType<typeof harness>;

async function confirmedA(h: Harness): Promise<Unsubscribe> {
  const detach = await h.connection.attach(topic, () => {});
  expect(h.subscriptions).toHaveLength(1);
  expect(h.subscriptions[0].active).toBe(true);
  return detach;
}

async function waitForB(h: Harness): Promise<void> {
  await vi.waitFor(() => expect(h.subscriptions).toHaveLength(2));
  expect(h.subscriptions[1].active).toBe(true);
}

function attachIdAt(h: Harness, index: number): string {
  const attach = h.pair.clientToServer.sent.filter((m) => m.kind === 'attach')[index];
  if (attach?.kind !== 'attach') throw new Error('Missing attach');
  return attach.id;
}

function expectHeldFrame(
  h: Harness,
  kind: 'update' | 'topic-gap' | 'topic-error',
  id: string
): void {
  expect(h.pair.serverToClient.queue).toContainEqual(
    expect.objectContaining({ kind, topic, attachId: id })
  );
}

describe('stale topic frames', () => {
  it('does not apply a non-retrying error from A to B', async () => {
    const h = harness();
    const detachA = await confirmedA(h);
    h.pair.serverToClient.held = true;
    h.subscriptions[0].onError(new WireError('HANDLER_ERROR', 'A failed'), { retrying: false });
    expectHeldFrame(h, 'topic-error', attachIdAt(h, 0));
    detachA();
    const errors: WireError[] = [];
    const updates: LiveUpdate[] = [];
    const attachB = h.connection.attach(topic, (update) => updates.push(update), {
      onReattachError: (error) => errors.push(error),
    });
    await waitForB(h);
    h.pair.serverToClient.flush();
    await attachB;
    h.subscriptions[1].push(u2);
    await h.connection.attach(topic, () => {});

    expect(errors).toEqual([]);
    expect(updates).toEqual([u2]);
    expect(h.pair.clientToServer.sent.filter((m) => m.kind === 'attach')).toHaveLength(2);
    expect(h.subscriptions[1].active).toBe(true);
    const retryingError = new WireError('HANDLER_ERROR', 'B retrying');
    h.subscriptions[1].onError(retryingError, { retrying: true });
    expect(errors).toEqual([retryingError]);
    h.close();
  });

  it('does not deliver an update from A to B', async () => {
    const h = harness();
    const detachA = await confirmedA(h);
    h.pair.serverToClient.held = true;
    h.subscriptions[0].push(u1);
    expectHeldFrame(h, 'update', attachIdAt(h, 0));
    detachA();
    const updates: LiveUpdate[] = [];
    const attachB = h.connection.attach(topic, (update) => updates.push(update));
    await waitForB(h);
    h.pair.serverToClient.flush();
    await attachB;
    h.subscriptions[1].push(u2);

    expect(updates, 'stale update from A reached B').toEqual([u2]);
    h.close();
  });

  it('does not deliver a gap from A to B', async () => {
    const h = harness();
    const detachA = await confirmedA(h);
    h.pair.serverToClient.held = true;
    h.subscriptions[0].onGap();
    expectHeldFrame(h, 'topic-gap', attachIdAt(h, 0));
    detachA();
    let reattachments = 0;
    const attachB = h.connection.attach(topic, () => {}, {
      onReattach: () => {
        reattachments += 1;
      },
    });
    await waitForB(h);
    h.pair.serverToClient.flush();
    await attachB;

    expect(reattachments, 'stale topic-gap from A notified B').toBe(0);
    h.subscriptions[1].onGap();
    expect(reattachments).toBe(1);
    h.close();
  });

  it('ignores held frames from A and B after rapid A/B/C replacements', async () => {
    const h = harness();
    const detachA = await confirmedA(h);
    h.pair.serverToClient.held = true;
    h.subscriptions[0].push(u1);
    h.subscriptions[0].onError(new WireError('HANDLER_ERROR', 'A failed'), { retrying: false });
    detachA();
    const abortB = new AbortController();
    const attachB = h.connection.attach(topic, () => {}, { signal: abortB.signal });
    const cancelledB = expect(attachB).rejects.toMatchObject({ code: 'CANCELLED' });
    await waitForB(h);
    h.subscriptions[1].push(u1);
    h.subscriptions[1].onError(new WireError('HANDLER_ERROR', 'B failed'), { retrying: false });
    abortB.abort();
    await cancelledB;
    const errors: WireError[] = [];
    const updates: LiveUpdate[] = [];
    const attachC = h.connection.attach(topic, (update) => updates.push(update), {
      onReattachError: (error) => errors.push(error),
    });
    await vi.waitFor(() => expect(h.subscriptions).toHaveLength(3));
    for (const index of [0, 1]) {
      expectHeldFrame(h, 'update', attachIdAt(h, index));
      expectHeldFrame(h, 'topic-error', attachIdAt(h, index));
    }
    h.pair.serverToClient.flush();
    await attachC;
    h.subscriptions[2].push(u2);
    expect(updates).toEqual([u2]);
    expect(errors).toEqual([]);
    h.close();
  });
});

describe('stale frames outlive other attachment changes', () => {
  async function leaveAndAbandon(h: Harness, name: string): Promise<void> {
    const controller = new AbortController();
    const pending = h.connection.attach(name, () => {}, { signal: controller.signal });
    controller.abort();
    await pending.catch(() => {});
  }

  it('still drops a stale frame after many other topics were left', async () => {
    const h = harness();
    const updates: LiveUpdate[] = [];
    const detachA = await h.connection.attach(topic, () => {});
    h.pair.serverToClient.held = true;
    h.subscriptions[0].push(u1);
    detachA();
    for (let i = 0; i < 300; i++) await leaveAndAbandon(h, `other-${i}`);
    const attachB = h.connection.attach(topic, (update) => updates.push(update));
    h.pair.serverToClient.flush();
    await attachB;
    expect(updates).toEqual([]);
    h.close();
  });

  it('still drops a stale frame after many reopen cycles of the same topic', async () => {
    const h = harness();
    const updates: LiveUpdate[] = [];
    const detachA = await h.connection.attach(topic, () => {});
    h.pair.serverToClient.held = true;
    h.subscriptions[0].push(u1);
    detachA();
    for (let i = 0; i < 20; i++) await leaveAndAbandon(h, topic);
    const attachB = h.connection.attach(topic, (update) => updates.push(update));
    h.pair.serverToClient.flush();
    await attachB;
    expect(updates).toEqual([]);
    h.close();
  });
});

describe('topic attachment compatibility', () => {
  it('delivers unstamped legacy frames to the current attachment', async () => {
    const h = harness();
    const updates: LiveUpdate[] = [];
    const errors: WireError[] = [];
    await h.connection.attach(topic, (update) => updates.push(update), {
      onReattachError: (error) => errors.push(error),
    });
    h.pair.server.post({ kind: 'update', topic, update: u1 });
    h.pair.server.post({
      kind: 'topic-error',
      topic,
      error: { code: 'HANDLER_ERROR', message: 'legacy' },
      retrying: true,
    });

    expect(updates).toEqual([u1]);
    expect(errors.map((error) => error.message)).toEqual(['legacy']);
    h.close();
  });

  it('rejects non-string attach ids on topic frames', () => {
    for (const frame of [
      { kind: 'update', topic, update: u1 },
      { kind: 'topic-gap', topic },
      {
        kind: 'topic-error',
        topic,
        error: { code: 'HANDLER_ERROR', message: 'error' },
        retrying: true,
      },
    ]) {
      expect(isWireMessage(frame)).toBe(true);
      expect(isWireMessage({ ...frame, attachId: 'A' })).toBe(true);
      expect(isWireMessage({ ...frame, attachId: 1 })).toBe(false);
    }
  });

  it('keeps two connections on one transport sharing a topic attachment', async () => {
    const h = harness();
    const second = connect(h.pair.client, { callTimeoutMs: 0 });
    const first: LiveUpdate[] = [];
    const other: LiveUpdate[] = [];
    await h.connection.attach(topic, (update) => first.push(update));
    await second.attach(topic, (update) => other.push(update));
    expect(h.subscriptions).toHaveLength(1);
    h.subscriptions[0].push(u1);

    expect(first).toEqual([u1]);
    expect(other).toEqual([u1]);
    second.dispose();
    h.close();
  });

  it('drops a held frame stamped with a shared attachment id after one connection reopens', async () => {
    const h = harness();
    const second = connect(h.pair.client, { callTimeoutMs: 0 });
    await h.connection.attach(topic, () => {});
    const detachSecond = await second.attach(topic, () => {});
    expect(h.subscriptions).toHaveLength(1);
    h.pair.serverToClient.held = true;
    h.subscriptions[0].push(u1);
    detachSecond();
    const updates: LiveUpdate[] = [];
    const reopened = second.attach(topic, (update) => updates.push(update));
    h.pair.serverToClient.flush();
    await reopened;

    expect(updates).toEqual([]);
    second.dispose();
    h.close();
  });

  it('drops a stale error after a shared attach was cancelled before its result arrived', async () => {
    const h = harness();
    const second = connect(h.pair.client, { callTimeoutMs: 0 });
    await h.connection.attach(topic, () => {});
    h.pair.serverToClient.held = true;
    const controller = new AbortController();
    const cancelled = second.attach(topic, () => {}, { signal: controller.signal });
    await vi.waitFor(() =>
      expect(h.pair.serverToClient.queue.some((m) => m.kind === 'result' && m.ok)).toBe(true)
    );
    h.subscriptions[0].onError(new WireError('HANDLER_ERROR', 'old'), { retrying: false });
    controller.abort();
    await cancelled.catch(() => {});
    const updates: LiveUpdate[] = [];
    const reopened = second.attach(topic, (update) => updates.push(update));
    h.pair.serverToClient.flush();
    await reopened;
    await vi.waitFor(() => expect(h.subscriptions).toHaveLength(2));
    h.subscriptions[1].push(u2);

    expect(updates).toEqual([u2]);
    second.dispose();
    h.close();
  });

  it('re-attaches after disconnect and ignores frames from the old session', async () => {
    const h = harness();
    const updates: LiveUpdate[] = [];
    await h.connection.attach(topic, (update) => updates.push(update));
    const oldId = attachIdAt(h, 0);
    h.pair.disconnect();
    expect(h.subscriptions[0].active).toBe(false);
    h.pair.reconnect();
    await waitForB(h);
    await h.connection.attach(topic, () => {});
    expect(attachIdAt(h, 1)).not.toBe(oldId);
    h.pair.server.post({ kind: 'update', topic, attachId: oldId, update: u1 });
    h.subscriptions[1].push(u2);
    expect(updates).toEqual([u2]);
    h.close();
  });
});

describe('no regression: detach ordering', () => {
  // These guard existing detach behaviour, not the stale-frame fix.
  it('preserves B when A is detached before a held attach for B', async () => {
    const h = harness();
    const detachA = await confirmedA(h);
    h.pair.clientToServer.held = true;
    detachA();
    const updates: LiveUpdate[] = [];
    const attachB = h.connection.attach(topic, (update) => updates.push(update));
    expect(h.pair.clientToServer.queue.map((m) => m.kind)).toEqual(['detach', 'attach']);
    h.pair.clientToServer.flush();
    await waitForB(h);
    await attachB;
    h.subscriptions[1].push(u2);

    expect(
      { active: h.subscriptions[1].active, updates },
      'stale detach removed B after queued attach'
    ).toEqual({ active: true, updates: [u2] });
    h.close();
  });

  it('preserves B when A is cancelled before its attach result arrives', async () => {
    const h = harness();
    h.pair.serverToClient.held = true;
    const abortA = new AbortController();
    const attachA = h.connection.attach(topic, () => {}, { signal: abortA.signal });
    const cancelledA = expect(attachA).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(h.subscriptions).toHaveLength(1));
    await vi.waitFor(() =>
      expect(h.pair.serverToClient.queue.some((m) => m.kind === 'result' && m.ok)).toBe(true)
    );
    expect(h.subscriptions[0].active).toBe(true);
    abortA.abort();
    await cancelledA;
    const updates: LiveUpdate[] = [];
    const attachB = h.connection.attach(topic, (update) => updates.push(update));
    await waitForB(h);
    h.pair.serverToClient.flush();
    await attachB;
    h.subscriptions[1].push(u2);

    expect(
      { active: h.subscriptions[1].active, updates },
      'late result or detach for A removed B'
    ).toEqual({ active: true, updates: [u2] });
    h.close();
  });

  it('preserves B across disconnect, unsubscribe and reconnect', async () => {
    const h = harness();
    const detachA = await confirmedA(h);
    h.pair.disconnect();
    expect(h.subscriptions[0].active).toBe(false);
    detachA();
    const updates: LiveUpdate[] = [];
    const attachB = h.connection.attach(topic, (update) => updates.push(update));
    const heldCall = h.connection.call('ping', {});
    expect(h.pair.clientToServer.sent.filter((m) => m.kind === 'attach')).toHaveLength(1);
    h.pair.reconnect();
    await waitForB(h);
    await attachB;
    await expect(heldCall).resolves.toBe('ok');
    h.subscriptions[1].push(u2);

    expect(
      { active: h.subscriptions[1].active, updates },
      'detach from before reconnect removed B'
    ).toEqual({ active: true, updates: [u2] });
    h.close();
  });
});

type LogSubscription = Pick<Subscription, 'onGap' | 'onError'>;

function logHarness() {
  const pair = transportPair();
  const log = new LiveLogSource({ generation: 1 });
  const subscriptions: LogSubscription[] = [];
  const counts = { snapshots: 0 };
  const source = {
    snapshot: () => {
      counts.snapshots += 1;
      return log.snapshot();
    },
    subscribe: (push: Parameters<LiveLogSource['subscribe']>[0], options: LogSubscription) => {
      subscriptions.push(options);
      return log.subscribe(push);
    },
  };
  const controller = {
    call: async () => 'ok',
    acquireLive: () => ({ ready: async () => source, release: async () => {} }),
  } as unknown as Controller;
  const stop = serve(pair.server, controller);
  const connection = connect(pair.client, { callTimeoutMs: 0 });
  const handle = {
    topic,
    snapshot: () => connection.snapshot(topic),
    attach: (push: never, options: never) => connection.attach(topic, push, options),
  } as never;
  const openViewer = async () => {
    const attached = subscriptions.length;
    const viewer = new ReplicaLog(handle);
    await vi.waitFor(() => expect(subscriptions).toHaveLength(attached + 1));
    return viewer;
  };
  return {
    pair,
    log,
    subscriptions,
    counts,
    openViewer,
    close() {
      connection.dispose();
      stop();
    },
  };
}

async function reopenWhileFramesAreHeld(
  h: ReturnType<typeof logHarness>,
  sendStale: () => void,
  staleKind: string
) {
  const first = await h.openViewer();
  await first.ready;
  h.log.append('one\n');
  await vi.waitFor(() => expect(first.text()).toBe('one\n'));
  h.pair.serverToClient.held = true;
  sendStale();
  await first.dispose();
  const snapshotsBefore = h.counts.snapshots;
  const second = await h.openViewer();
  await vi.waitFor(() => expect(h.counts.snapshots).toBe(snapshotsBefore + 1));
  expect(h.pair.serverToClient.queue.some((m) => m.kind === staleKind)).toBe(true);
  h.pair.serverToClient.flush();
  await second.ready;
  await vi.waitFor(() => expect(h.pair.serverToClient.queue).toHaveLength(0));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { second, snapshotsBefore };
}

describe('a terminal log reopened while old frames are in flight', () => {
  it('keeps receiving output after a stale non-retrying error', async () => {
    const h = logHarness();
    const { second } = await reopenWhileFramesAreHeld(
      h,
      () => h.subscriptions[0].onError(new WireError('HANDLER_ERROR', 'old'), { retrying: false }),
      'topic-error'
    );
    h.log.append('two\n');
    await vi.waitFor(() => expect(second.text()).toBe('one\ntwo\n'));
    h.close();
  });

  it('does not resync for a stale update', async () => {
    const h = logHarness();
    const { second, snapshotsBefore } = await reopenWhileFramesAreHeld(
      h,
      () => h.log.append('two\n'),
      'update'
    );
    h.log.append('three\n');
    await vi.waitFor(() => expect(second.text()).toBe('one\ntwo\nthree\n'));
    expect(h.counts.snapshots).toBe(snapshotsBefore + 1);
    h.close();
  });

  it('does not resync for a stale gap', async () => {
    const h = logHarness();
    const { second, snapshotsBefore } = await reopenWhileFramesAreHeld(
      h,
      () => h.subscriptions[0].onGap(),
      'topic-gap'
    );
    h.log.append('two\n');
    await vi.waitFor(() => expect(second.text()).toBe('one\ntwo\n'));
    expect(h.counts.snapshots).toBe(snapshotsBefore + 1);
    h.close();
  });
});

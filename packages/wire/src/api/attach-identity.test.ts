import { systemClock } from '@emdash/shared/scheduling';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPressureSignal, type LiveUpdate, type PressureSignal } from './channel';
import { connect } from './connect';
import type { Controller } from './controller';
import { creditSize, isWireMessage, type WireMessage, type WireTransport } from './protocol';
import { serve } from './serve';

type Subscription = {
  push: (update: LiveUpdate) => void;
  pressure: PressureSignal;
  onGap: () => void;
  onError: (error: Error, context: { retrying: boolean }) => void;
  active: boolean;
};

function createHarness() {
  const clientHandlers = new Set<(message: WireMessage) => void>();
  const serverHandlers = new Set<(message: WireMessage) => void>();
  const clientDisconnects = new Set<() => void>();
  const serverDisconnects = new Set<() => void>();
  const reconnects = new Set<() => void>();
  const sent: WireMessage[] = [];
  const received: WireMessage[] = [];
  const subscriptions: Subscription[] = [];
  let failPost: ((message: WireMessage) => boolean) | undefined;

  const client: WireTransport = {
    post(message) {
      if (failPost?.(message)) throw new Error('Post failed');
      sent.push(message);
      for (const handler of serverHandlers) handler(message);
    },
    onMessage(handler) {
      clientHandlers.add(handler);
      return () => clientHandlers.delete(handler);
    },
    onDisconnect(handler) {
      clientDisconnects.add(handler);
      return () => clientDisconnects.delete(handler);
    },
    onReconnect(handler) {
      reconnects.add(handler);
      return () => reconnects.delete(handler);
    },
  };
  const server: WireTransport = {
    post(message) {
      received.push(message);
      for (const handler of clientHandlers) handler(message);
    },
    onMessage(handler) {
      serverHandlers.add(handler);
      return () => serverHandlers.delete(handler);
    },
    onDisconnect(handler) {
      serverDisconnects.add(handler);
      return () => serverDisconnects.delete(handler);
    },
  };
  const source = {
    subscribe(
      push: Subscription['push'],
      options: Pick<Subscription, 'pressure' | 'onGap' | 'onError'>
    ) {
      const subscription: Subscription = { push, ...options, active: true };
      subscriptions.push(subscription);
      return () => {
        subscription.active = false;
      };
    },
  };
  const call = vi.fn(async () => 'called');
  const controller = {
    call,
    acquireLive: () => ({ ready: async () => source, release: async () => {} }),
  } as unknown as Controller;

  return {
    client,
    server,
    controller,
    call,
    sent,
    received,
    subscriptions,
    emit(update: LiveUpdate) {
      for (const subscription of subscriptions) {
        if (subscription.active) subscription.push(update);
      }
    },
    deliver(message: WireMessage) {
      for (const handler of clientHandlers) handler(message);
    },
    setFailPost(fn?: (message: WireMessage) => boolean) {
      failPost = fn;
    },
    drop() {
      for (const handler of clientDisconnects) handler();
      for (const handler of serverDisconnects) handler();
    },
    dropServer() {
      for (const handler of serverDisconnects) handler();
    },
    reconnect() {
      for (const handler of reconnects) handler();
    },
  };
}

const update = { generation: 1, offset: 1, value: 'one' } as unknown as LiveUpdate;
const nextUpdate = { generation: 1, offset: 2, value: 'two' } as unknown as LiveUpdate;

async function rawAttach(h: ReturnType<typeof createHarness>, id: string, window?: number) {
  h.client.post({ kind: 'attach', id, topic: 'T', ...(window === undefined ? {} : { window }) });
  await vi.waitFor(() => {
    expect(h.received).toContainEqual({
      kind: 'result',
      id,
      ok: true,
      value: window === undefined ? undefined : { window },
    });
  });
}

function messages(h: ReturnType<typeof createHarness>, kind: WireMessage['kind']) {
  return h.received.filter((message) => message.kind === kind);
}

function lastAttachId(h: ReturnType<typeof createHarness>): string {
  const attach = h.sent.filter((message) => message.kind === 'attach').at(-1);
  if (!attach || attach.kind !== 'attach') throw new Error('Missing attach');
  return attach.id;
}

afterEach(() => vi.useRealTimers());

describe('attach identity', () => {
  it('validates optional attach ids on every topic frame', () => {
    const frames: WireMessage[] = [
      { kind: 'detach', topic: 'T' },
      { kind: 'topic-pressure', topic: 'T', paused: true },
      { kind: 'topic-credit', topic: 'T', consumed: 0 },
      { kind: 'update', topic: 'T', update },
      { kind: 'topic-gap', topic: 'T' },
      {
        kind: 'topic-error',
        topic: 'T',
        error: { code: 'NOT_FOUND', message: 'gone' },
        retrying: false,
      },
    ];
    for (const frame of frames) {
      expect(isWireMessage(frame)).toBe(true);
      expect(isWireMessage({ ...frame, attachId: 'A1' })).toBe(true);
      expect(isWireMessage({ ...frame, attachId: 12 })).toBe(false);
      expect(isWireMessage({ ...frame, attachId: null })).toBe(false);
    }
  });

  it('a stale detach leaves the replacement and its credit gate alive', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    try {
      await rawAttach(h, 'A1', creditSize(update));
      await rawAttach(h, 'A2', creditSize(update));
      expect(h.subscriptions[0].active).toBe(false);
      h.client.post({ kind: 'detach', topic: 'T', attachId: 'A1' });
      expect(h.subscriptions[1].active).toBe(true);
      h.emit(update);
      expect(messages(h, 'update')).toContainEqual({
        kind: 'update',
        topic: 'T',
        attachId: 'A2',
        update,
        flow: true,
      });
      h.emit(nextUpdate);
      expect(messages(h, 'update')).toHaveLength(1);
      h.client.post({
        kind: 'topic-credit',
        topic: 'T',
        attachId: 'A2',
        consumed: creditSize(update),
      });
      expect(messages(h, 'update')).toContainEqual({
        kind: 'update',
        topic: 'T',
        attachId: 'A2',
        update: nextUpdate,
        flow: true,
      });
    } finally {
      stop();
    }
  });

  it('stale pressure and credit cannot affect the replacement', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    try {
      await rawAttach(h, 'A1', creditSize(update));
      await rawAttach(h, 'A2', creditSize(update));
      h.client.post({ kind: 'topic-pressure', topic: 'T', attachId: 'A1', paused: true });
      expect(h.subscriptions[1].pressure.paused).toBe(false);
      h.emit(update);
      h.emit(nextUpdate);
      const before = messages(h, 'update').length;
      h.client.post({
        kind: 'topic-credit',
        topic: 'T',
        attachId: 'A1',
        consumed: creditSize(update),
      });
      expect(messages(h, 'update')).toHaveLength(before);
      h.client.post({
        kind: 'topic-credit',
        topic: 'T',
        attachId: 'A2',
        consumed: creditSize(update),
      });
      expect(messages(h, 'update').length).toBeGreaterThan(before);
    } finally {
      stop();
    }
  });

  it('accepts legacy topic-only frames in both directions', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client);
    try {
      const pushes = vi.fn();
      const notice = vi.fn();
      const detach = await connection.attach('T', pushes, { onReattach: notice });
      h.deliver({ kind: 'update', topic: 'T', update });
      h.deliver({ kind: 'topic-gap', topic: 'T' });
      expect(pushes).toHaveBeenCalledWith(update);
      expect(notice).toHaveBeenCalledOnce();
      h.client.post({ kind: 'topic-pressure', topic: 'T', paused: true });
      expect(h.subscriptions[0].pressure.paused).toBe(true);
      h.client.post({ kind: 'topic-pressure', topic: 'T', paused: false });
      h.client.post({ kind: 'detach', topic: 'T' });
      expect(h.subscriptions[0].active).toBe(false);
      detach();
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('replacement disposes the old gate and starts with the new window', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    try {
      await rawAttach(h, 'A1', 0);
      h.emit(update);
      expect(messages(h, 'update')).toEqual([
        { kind: 'update', topic: 'T', attachId: 'A1', update, flow: true },
      ]);
      h.emit(nextUpdate);
      expect(messages(h, 'update')).toHaveLength(1);
      await rawAttach(h, 'A2', creditSize(update) * 4);
      expect(h.subscriptions[0].active).toBe(false);
      expect(h.subscriptions[0].pressure.paused).toBe(false);
      h.emit(update);
      expect(messages(h, 'update')).toEqual([
        { kind: 'update', topic: 'T', attachId: 'A1', update, flow: true },
        { kind: 'update', topic: 'T', attachId: 'A2', update, flow: true },
      ]);
      expect(h.subscriptions[1].pressure.paused).toBe(false);
    } finally {
      stop();
    }
  });

  it('stamps client posts and keeps the old id on owed detach after reconnect', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { creditWindow: creditSize(update) * 4 });
    try {
      const pressure = createPressureSignal();
      const detach = await connection.attach('T', () => {}, { pressure });
      const oldId = lastAttachId(h);
      pressure.set(true);
      expect(h.sent).toContainEqual({
        kind: 'topic-pressure',
        topic: 'T',
        attachId: oldId,
        paused: true,
      });
      h.emit(update);
      expect(h.sent).toContainEqual({
        kind: 'topic-credit',
        topic: 'T',
        attachId: oldId,
        consumed: creditSize(update),
      });
      h.setFailPost((message) => message.kind === 'detach');
      detach();
      h.setFailPost();
      h.drop();
      h.reconnect();
      expect(h.sent).toContainEqual({ kind: 'detach', topic: 'T', attachId: oldId });
      const next = await connection.attach('T', () => {}, { pressure });
      const newId = lastAttachId(h);
      expect(newId).not.toBe(oldId);
      h.drop();
      h.reconnect();
      const reattachId = lastAttachId(h);
      expect(reattachId).not.toBe(newId);
      expect(h.sent).not.toContainEqual({ kind: 'detach', topic: 'T', attachId: newId });
      next();
      expect(h.sent).toContainEqual({ kind: 'detach', topic: 'T', attachId: reattachId });
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('replays an old detach after a replacement attach fails and is cancelled', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client);
    try {
      const detach = await connection.attach('T', () => {});
      const oldId = lastAttachId(h);
      h.setFailPost((message) => message.kind === 'detach' && message.attachId === oldId);
      detach();
      expect(h.subscriptions[0].active).toBe(true);

      h.setFailPost((message) => message.kind === 'attach');
      const abort = new AbortController();
      const replacement = connection.attach('T', () => {}, { signal: abort.signal });
      abort.abort();
      await expect(replacement).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(h.subscriptions[0].active).toBe(true);

      h.setFailPost();
      h.reconnect();
      expect(h.sent).toContainEqual({ kind: 'detach', topic: 'T', attachId: oldId });
      expect(h.subscriptions[0].active).toBe(false);
      expect(h.subscriptions.filter((subscription) => subscription.active)).toHaveLength(0);
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('keeps every owed detach across many confirmed topics and replays them all', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { clock: systemClock });
    try {
      h.setFailPost((message) => message.kind === 'detach');
      const debts: WireMessage[] = [];
      for (let index = 0; index < 65; index += 1) {
        const topic = `T${index}`;
        const detach = await connection.attach(topic, () => {});
        const attach = h.sent.at(-1);
        if (!attach || attach.kind !== 'attach') throw new Error('Missing attach');
        debts.push({ kind: 'detach', topic, attachId: attach.id });
        detach();
      }
      expect(h.subscriptions).toHaveLength(65);
      expect(h.subscriptions.every((subscription) => subscription.active)).toBe(true);

      h.setFailPost();
      await vi.advanceTimersByTimeAsync(100);
      expect(h.sent.filter((message) => message.kind === 'detach')).toEqual(debts);
      expect(h.subscriptions.every((subscription) => !subscription.active)).toBe(true);
      const detach = await connection.attach('T65', () => {});
      expect(h.subscriptions.at(-1)?.active).toBe(true);
      detach();
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('keeps every debt from aborted unconfirmed attaches and replays them all', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { clock: systemClock });
    try {
      h.setFailPost((message) => message.kind === 'detach');
      const ids: string[] = [];
      for (let index = 0; index < 70; index += 1) {
        const abort = new AbortController();
        const attaching = connection.attach('T', () => {}, { signal: abort.signal });
        ids.push(lastAttachId(h));
        abort.abort();
        await expect(attaching).rejects.toMatchObject({ code: 'CANCELLED' });
      }
      expect(h.received.filter((message) => message.kind === 'result' && message.ok)).toHaveLength(
        0
      );
      expect(h.sent.filter((message) => message.kind === 'detach')).toHaveLength(0);

      h.setFailPost();
      await vi.advanceTimersByTimeAsync(100);
      expect(h.sent.filter((message) => message.kind === 'detach')).toEqual(
        ids.map((attachId) => ({ kind: 'detach', topic: 'T', attachId }))
      );
      const detach = await connection.attach('T', () => {});
      detach();
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('retires failed detach debts only after a replacement attach is confirmed', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { clock: systemClock });
    try {
      h.setFailPost((message) => message.kind === 'detach');
      const ids: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        const detach = await connection.attach('T', () => {});
        ids.push(lastAttachId(h));
        detach();
      }
      expect(h.sent.filter((message) => message.kind === 'detach')).toHaveLength(0);
      h.setFailPost();
      await vi.advanceTimersByTimeAsync(100);
      expect(h.sent.filter((message) => message.kind === 'detach')).toEqual([
        { kind: 'detach', topic: 'T', attachId: ids.at(-1) },
      ]);
      expect(h.subscriptions.at(-1)?.active).toBe(false);
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('does not retry unpause after a direct detach succeeds', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { clock: systemClock });
    try {
      const pressure = createPressureSignal();
      pressure.set(true);
      const detach = await connection.attach('T', () => {}, { pressure });
      const id = lastAttachId(h);
      let unpauseAttempts = 0;
      h.setFailPost((message) => {
        if (message.kind === 'topic-pressure' && !message.paused) {
          unpauseAttempts += 1;
          return true;
        }
        return false;
      });
      detach();
      expect(unpauseAttempts).toBe(1);
      expect(h.sent).toContainEqual({ kind: 'detach', topic: 'T', attachId: id });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(unpauseAttempts).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('replays a detach even while its unpause keeps failing', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { clock: systemClock });
    try {
      const pressure = createPressureSignal();
      pressure.set(true);
      const detach = await connection.attach('T', () => {}, { pressure });
      const id = lastAttachId(h);
      let detachAttempts = 0;
      let unpauseAttempts = 0;
      h.setFailPost((message) => {
        if (message.kind === 'topic-pressure' && !message.paused) {
          unpauseAttempts += 1;
          return true;
        }
        if (message.kind === 'detach' && message.attachId === id) {
          detachAttempts += 1;
          return detachAttempts === 1;
        }
        return false;
      });
      detach();
      expect(h.subscriptions[0].active).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(detachAttempts).toBe(2);
      expect(h.sent).toContainEqual({ kind: 'detach', topic: 'T', attachId: id });
      expect(h.subscriptions[0].active).toBe(false);
      const attempts = { detachAttempts, unpauseAttempts };
      await vi.advanceTimersByTimeAsync(20_000);
      expect({ detachAttempts, unpauseAttempts }).toEqual(attempts);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('a throwing debt replay does not block held calls or reattach, and retries without reconnect', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { clock: systemClock });
    try {
      const detach = await connection.attach('T', () => {});
      const oldId = lastAttachId(h);
      const keep = await connection.attach('other', () => {});
      h.drop();
      h.setFailPost((message) => message.kind === 'detach' && message.attachId === oldId);
      detach();
      const held = connection.call('work', null);
      h.reconnect();
      expect(await held).toBe('called');
      expect(h.sent.filter((message) => message.kind === 'attach')).toHaveLength(3);
      h.setFailPost();
      await vi.advanceTimersByTimeAsync(100);
      expect(h.sent).toContainEqual({ kind: 'detach', topic: 'T', attachId: oldId });
      keep();
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('drops an obsolete unpause after a successful detach, retries live pressure, and cancels the timer on dispose', async () => {
    vi.useFakeTimers();
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { clock: systemClock });
    try {
      const pressure = createPressureSignal();
      pressure.set(true);
      const detach = await connection.attach('T', () => {}, { pressure });
      const id = lastAttachId(h);
      h.setFailPost((message) => message.kind === 'topic-pressure' && !message.paused);
      detach();
      h.setFailPost();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.sent).not.toContainEqual({
        kind: 'topic-pressure',
        topic: 'T',
        attachId: id,
        paused: false,
      });
      const next = await connection.attach('T', () => {}, { pressure });
      const nextId = lastAttachId(h);
      h.setFailPost((message) => message.kind === 'topic-pressure');
      pressure.set(false);
      h.setFailPost();
      await vi.advanceTimersByTimeAsync(100);
      expect(h.sent).toContainEqual({
        kind: 'topic-pressure',
        topic: 'T',
        attachId: nextId,
        paused: false,
      });
      h.setFailPost((message) => message.kind === 'topic-pressure');
      pressure.set(true);
      const count = h.sent.length;
      connection.dispose();
      h.setFailPost();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.sent).toHaveLength(count + 1); // dispose sends the final detach
      next();
    } finally {
      connection.dispose();
      stop();
    }
  });

  it.each(['B first', 'A first'])(
    'two connections: %s preserves B across A debt replay',
    async (order) => {
      const h = createHarness();
      const stop = serve(h.server, h.controller);
      const a = order === 'A first' ? connect(h.client) : undefined;
      const b = connect(h.client);
      const connectionA = a ?? connect(h.client);
      const pressure = createPressureSignal();
      pressure.set(true);
      const pushes = vi.fn();
      let bAttach: Promise<() => void> | undefined;
      const listen = h.client.onReconnect?.(() => {
        bAttach = b.attach('T', pushes, { pressure });
      });
      try {
        const detachA = await connectionA.attach('T', () => {});
        const aId = lastAttachId(h);
        h.setFailPost((message) => message.kind === 'detach' && message.attachId === aId);
        detachA();
        h.setFailPost();
        h.drop();
        h.reconnect();
        const detachB = await bAttach!;
        const bId = lastAttachId(h);
        expect(bId).not.toBe(aId);
        expect(h.subscriptions.at(-1)?.active).toBe(true);
        expect(h.subscriptions.at(-1)?.pressure.paused).toBe(true);
        expect(h.sent).toContainEqual({ kind: 'detach', topic: 'T', attachId: aId });
        h.emit(update);
        expect(pushes).toHaveBeenCalledWith(update);
        detachB();
      } finally {
        listen?.();
        connectionA.dispose();
        b.dispose();
        stop();
      }
    }
  );

  it('ignores stale server updates, gaps and terminal errors after reattach', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const connection = connect(h.client, { creditWindow: 1 });
    try {
      const pushes = vi.fn();
      const notice = vi.fn();
      const errors = vi.fn();
      const detach = await connection.attach('T', pushes, {
        onReattach: notice,
        onReattachError: errors,
      });
      const oldId = lastAttachId(h);
      h.reconnect();
      const newId = lastAttachId(h);
      expect(newId).not.toBe(oldId);
      await vi.waitFor(() => expect(notice).toHaveBeenCalledOnce());
      const creditCount = h.sent.filter((message) => message.kind === 'topic-credit').length;
      h.deliver({ kind: 'update', topic: 'T', attachId: oldId, update, flow: true });
      h.deliver({ kind: 'topic-gap', topic: 'T', attachId: oldId });
      h.deliver({
        kind: 'topic-error',
        topic: 'T',
        attachId: oldId,
        error: { code: 'NOT_FOUND', message: 'old' },
        retrying: false,
      });
      expect(pushes).not.toHaveBeenCalled();
      expect(notice).toHaveBeenCalledOnce();
      expect(errors).not.toHaveBeenCalled();
      expect(h.sent.filter((message) => message.kind === 'topic-credit')).toHaveLength(creditCount);
      h.deliver({ kind: 'update', topic: 'T', attachId: newId, update, flow: true });
      expect(pushes).toHaveBeenCalledWith(update);
      expect(h.sent).toContainEqual({
        kind: 'topic-credit',
        topic: 'T',
        attachId: newId,
        consumed: creditSize(update),
      });
      detach();
    } finally {
      connection.dispose();
      stop();
    }
  });

  it('closes the transport on dispose while a detach is still owed', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const close = vi.fn(() => h.dropServer());
    const connection = connect({ ...h.client, close });
    try {
      const detach = await connection.attach('T', () => {});
      h.setFailPost((message) => message.kind === 'detach');
      detach();
      expect(close).not.toHaveBeenCalled();
      expect(h.subscriptions[0].active).toBe(true);
      connection.dispose();
      expect(close).toHaveBeenCalledTimes(1);
      expect(h.subscriptions[0].active).toBe(false);
    } finally {
      h.setFailPost();
      stop();
    }
  });

  it('finishes disposal when a final detach fails and close throws', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const close = vi.fn(() => {
      throw new Error('close failed');
    });
    const connection = connect({ ...h.client, close });
    try {
      const onDisconnect = vi.fn();
      connection.onDisconnect(onDisconnect);
      await connection.attach('T', () => {});
      h.setFailPost((message) => message.kind === 'detach');
      expect(() => connection.dispose()).not.toThrow();
      expect(close).toHaveBeenCalledTimes(1);
      h.drop();
      expect(onDisconnect).not.toHaveBeenCalled();
    } finally {
      h.setFailPost();
      stop();
    }
  });

  it('leaves the transport open on dispose when every detach is posted', async () => {
    const h = createHarness();
    const stop = serve(h.server, h.controller);
    const close = vi.fn();
    const attached = connect({ ...h.client, close });
    const callOnly = connect({ ...h.client, close });
    try {
      await attached.attach('T', () => {});
      attached.dispose();
      callOnly.dispose();
      expect(close).not.toHaveBeenCalled();
      expect(h.subscriptions.every((subscription) => !subscription.active)).toBe(true);
    } finally {
      stop();
    }
  });
});

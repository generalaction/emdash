import type { Unsubscribe } from '@emdash/shared';
import type { TimerHandle } from '@emdash/shared/scheduling';
import { describe, expect, it } from 'vitest';
import type { LiveUpdate } from './channel';
import { connect } from './connect';
import { creditSize, type WireMessage, type WireTransport } from './protocol';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const CREDIT_IDLE_MS = 50;

class ManualClock {
  private current = 0;
  private nextId = 1;
  private timers: { id: number; callback: () => void; due: number }[] = [];

  now(): number {
    return this.current;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  schedule(delayMs: number, callback: () => void, _options?: { unref?: boolean }): TimerHandle {
    const id = this.nextId++;
    const due = this.current + delayMs;
    this.timers.push({ id, callback, due });
    const timers = () => this.timers;
    return {
      get active() {
        return timers().some((timer) => timer.id === id);
      },
      dispose: () => {
        this.timers = this.timers.filter((timer) => timer.id !== id);
      },
    };
  }

  advance(ms: number): void {
    this.current += ms;
    const due = this.timers
      .filter((timer) => timer.due <= this.current)
      .sort((a, b) => a.due - b.due);
    this.timers = this.timers.filter((timer) => timer.due > this.current);
    for (const timer of due) timer.callback();
  }
}

class TestTransport implements WireTransport {
  readonly sent: WireMessage[] = [];
  private readonly messageListeners = new Set<(message: WireMessage) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly reconnectListeners = new Set<() => void>();

  constructor(private readonly attachResult: unknown = undefined) {}

  post(message: WireMessage): void {
    this.sent.push(message);
    if (message.kind === 'attach') {
      const result = this.attachResult;
      queueMicrotask(() => {
        for (const listener of this.messageListeners) {
          listener({ kind: 'result', id: message.id, ok: true, value: result });
        }
      });
    }
  }

  onMessage(cb: (message: WireMessage) => void): Unsubscribe {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onDisconnect(cb: () => void): Unsubscribe {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  onReconnect(cb: () => void): Unsubscribe {
    this.reconnectListeners.add(cb);
    return () => this.reconnectListeners.delete(cb);
  }

  emit(message: WireMessage): void {
    for (const listener of [...this.messageListeners]) listener(message);
  }

  reconnect(): void {
    for (const listener of [...this.reconnectListeners]) listener();
  }

  get attachMessages(): Extract<WireMessage, { kind: 'attach' }>[] {
    return this.sent.filter((message) => message.kind === 'attach') as Extract<
      WireMessage,
      { kind: 'attach' }
    >[];
  }

  get topicCreditMessages(): Extract<WireMessage, { kind: 'topic-credit' }>[] {
    return this.sent.filter((message) => message.kind === 'topic-credit') as Extract<
      WireMessage,
      { kind: 'topic-credit' }
    >[];
  }
}

class QueueLiveSource {
  private subscribers = new Set<(update: unknown) => void>();

  subscribe(push: (update: unknown) => void, _options: unknown): Unsubscribe {
    this.subscribers.add(push);
    return () => this.subscribers.delete(push);
  }

  emit(update: unknown): void {
    for (const subscriber of [...this.subscribers]) subscriber(update);
  }
}

function update(sequence: number): LiveUpdate {
  return {
    generation: 0,
    baseSequence: 0,
    sequence,
    timestamp: 0,
    delta: undefined,
  };
}

// One update's credit units; a window of eight updates reports at a quarter, two updates.
const SIZE = creditSize(update(0));
const WINDOW = 8 * SIZE;

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(condition: () => boolean): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 2_000) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('connect credit client', () => {
  it('sends the attach window only when creditWindow is configured', async () => {
    const withoutWindow = new TestTransport();
    const noWindowConnection = connect(withoutWindow);
    await noWindowConnection.attach('topic', () => {});

    expect(withoutWindow.attachMessages).toHaveLength(1);
    expect(withoutWindow.attachMessages[0]).not.toHaveProperty('window');
    noWindowConnection.dispose();

    const withWindow = new TestTransport({ window: 7 });
    const windowConnection = connect(withWindow, { creditWindow: 7 });
    await windowConnection.attach('topic', () => {});

    expect(withWindow.attachMessages).toHaveLength(1);
    expect(withWindow.attachMessages[0]).toMatchObject({ window: 7 });
    windowConnection.dispose();
  });

  it('reports credit at a quarter window and after the idle delay', async () => {
    const transport = new TestTransport({ window: WINDOW });
    const clock = new ManualClock();
    const connection = connect(transport, { creditWindow: WINDOW, clock });

    await connection.attach('items', () => {});
    transport.sent.length = 0;

    transport.emit({ kind: 'update', topic: 'items', update: update(0), flow: true });
    await flush();
    expect(transport.topicCreditMessages).toHaveLength(0);

    clock.advance(CREDIT_IDLE_MS);
    expect(transport.topicCreditMessages).toHaveLength(1);
    expect(transport.topicCreditMessages[0]).toMatchObject({
      topic: 'items',
      consumed: SIZE,
    });

    transport.sent.length = 0;
    transport.emit({ kind: 'update', topic: 'items', update: update(0), flow: true });
    transport.emit({ kind: 'update', topic: 'items', update: update(1), flow: true });
    await flush();

    expect(transport.topicCreditMessages).toHaveLength(1);
    expect(transport.topicCreditMessages[0]).toMatchObject({
      topic: 'items',
      consumed: 3 * SIZE,
    });
    connection.dispose();
  });

  it('resets credit counters on reconnect', async () => {
    const transport = new TestTransport({ window: WINDOW });
    const clock = new ManualClock();
    const connection = connect(transport, { creditWindow: WINDOW, clock });

    await connection.attach('items', () => {});
    transport.sent.length = 0;

    transport.emit({ kind: 'update', topic: 'items', update: update(0), flow: true });
    clock.advance(CREDIT_IDLE_MS);
    expect(transport.topicCreditMessages[0]).toMatchObject({ consumed: SIZE });

    transport.sent.length = 0;
    transport.reconnect();
    await waitFor(() => transport.attachMessages.length >= 1);
    await flush();

    transport.emit({ kind: 'update', topic: 'items', update: update(0), flow: true });
    await flush();
    expect(transport.topicCreditMessages).toHaveLength(0);

    clock.advance(CREDIT_IDLE_MS);
    expect(transport.topicCreditMessages).toHaveLength(1);
    expect(transport.topicCreditMessages[0]).toMatchObject({
      topic: 'items',
      consumed: SIZE,
    });
    connection.dispose();
  });

  it('does not send credit to a server that did not return a window', async () => {
    const transport = new TestTransport();
    const clock = new ManualClock();
    const connection = connect(transport, { creditWindow: 4, clock });

    await connection.attach('items', () => {});
    transport.sent.length = 0;

    transport.emit({ kind: 'update', topic: 'items', update: update(0), flow: true });
    await flush();
    clock.advance(CREDIT_IDLE_MS);

    expect(transport.topicCreditMessages).toHaveLength(0);
    connection.dispose();
  });

  it('delivers a burst of window * 10 updates in order without topic-gap', async () => {
    const source = new QueueLiveSource();
    const controller = {
      call: async () => {
        throw new Error('unused');
      },
      acquireLive: (topic: string) => {
        if (topic !== 'items') return undefined;
        return { ready: async () => source, release: async () => {} };
      },
    } as unknown as Parameters<typeof serve>[1];

    const pair = memoryTransportPair();
    const disposeServer = serve(pair.right, controller);
    const connection = connect(pair.left, { creditWindow: 4 });
    const updates: number[] = [];
    let gaps = 0;

    const detach = await connection.attach(
      'items',
      (update) => {
        updates.push(update.sequence);
      },
      {
        onReattach: () => {
          gaps += 1;
        },
      }
    );

    for (let seq = 0; seq < 40; seq += 1) source.emit(update(seq));

    await waitFor(() => updates.length === 40);
    expect(updates).toEqual(Array.from({ length: 40 }, (_, seq) => seq));
    expect(gaps).toBe(0);

    detach();
    connection.dispose();
    disposeServer();
    pair.disconnect();
  });
});

import { createManualClock } from '@emdash/shared/testing';
import { ReplicaLog } from '@emdash/wire/live';
import {
  encodeTopic,
  WireError,
  type AttachOptions,
  type Connection,
  type LiveSnapshot,
  type LiveUpdate,
} from '@emdash/wire/rpc';
import { describe, expect, it } from 'vitest';
import { ACTIVE_IDLE_MS, interactiveLaneConnection, MOVE_RETRY_MS } from './interactive-lane';

type Call = {
  path: string;
  input: Record<string, unknown>;
  options?: { signal?: AbortSignal; timeoutMs?: number };
  resolve(value?: unknown): void;
  reject(error: Error): void;
};
type Attach = {
  topic: string;
  push(update: LiveUpdate): void;
  detached: boolean;
};

/** A scripted Connection: calls stay pending until the test settles them. */
class FakeConnection {
  readonly calls: Call[] = [];
  readonly attaches: Attach[] = [];
  attachAttempts = 0;
  snapshotData: LiveSnapshot<unknown> = { generation: 1, sequence: 0, timestamp: 0, data: null };
  holdAttach = false;
  failAttach = false;
  /** When set, snapshots wait for it and return the data captured at request time. */
  snapshotGate: Promise<void> | undefined;
  private readonly heldAttaches: Array<{
    resolve(): void;
    reject(reason?: unknown): void;
  }> = [];

  readonly connection = {
    call: (path: string, input: unknown, options?: Call['options']) =>
      new Promise((resolve, reject) => {
        this.calls.push({
          path,
          input: input as Record<string, unknown>,
          options,
          resolve,
          reject,
        });
      }),
    snapshot: async () => {
      const captured = this.snapshotData;
      await this.snapshotGate;
      return captured;
    },
    attach: (topic: string, push: (update: LiveUpdate) => void) => {
      this.attachAttempts += 1;
      if (this.failAttach) return Promise.reject(new WireError('DISCONNECTED', 'lane down'));
      const entry: Attach = { topic, push, detached: false };
      this.attaches.push(entry);
      const detach = () => {
        entry.detached = true;
      };
      if (!this.holdAttach) return Promise.resolve(detach);
      return new Promise<() => void>((resolve, reject) => {
        this.heldAttaches.push({
          resolve: () => resolve(detach),
          reject,
        });
      });
    },
    openBlobConsumer: () => {
      throw new Error('unused');
    },
    openBlobProducer: () => {
      throw new Error('unused');
    },
    onDisconnect: () => () => {},
    dispose: () => {},
  } as unknown as Connection;

  releaseAttaches(): void {
    for (const held of this.heldAttaches.splice(0)) held.resolve();
  }

  rejectAttaches(error: Error): void {
    for (const held of this.heldAttaches.splice(0)) held.reject(error);
  }

  live(topic: string): Attach | undefined {
    return this.attaches.filter((entry) => entry.topic === topic && !entry.detached).at(-1);
  }

  liveTopics(): string[] {
    return [
      ...new Set(this.attaches.filter((entry) => !entry.detached).map((entry) => entry.topic)),
    ];
  }
}

const outputOf = (conversationId: string) => encodeTopic('tuiAgents.output', { conversationId });
const updateAt = (sequence: number, chunk = `${sequence}`): LiveUpdate => ({
  generation: 1,
  baseSequence: sequence - 1,
  sequence,
  timestamp: 0,
  delta: { chunk },
});
const logSnapshot = (sequence: number, text: string): LiveSnapshot<unknown> => ({
  generation: 1,
  sequence,
  timestamp: 0,
  data: { baseOffset: 0, text, truncated: false },
});
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const sendKey = (connection: Connection, conversationId: string, data = 'k') =>
  connection.call('tuiAgents.sendInput', { conversationId, data });
const sequenceOf = (call: Call) => call.input.sequence as { seq: number; replay?: boolean };
const disconnected = () => new WireError('DISCONNECTED', 'Wire transport disconnected');

function setup() {
  const bulk = new FakeConnection();
  const lane = new FakeConnection();
  const clock = createManualClock();
  const pendingTimers = new Set<{ dispose(): void }>();
  const schedule = clock.schedule.bind(clock);
  (clock as { schedule: typeof schedule }).schedule = ((...args: Parameters<typeof schedule>) => {
    const timer = schedule(...args);
    pendingTimers.add(timer);
    const dispose = timer.dispose.bind(timer);
    timer.dispose = () => {
      pendingTimers.delete(timer);
      dispose();
    };
    return timer;
  }) as typeof schedule;

  const reconnects = new Set<() => void>();
  const link = { connected: true, generation: 1, scope: 'daemon-1:1' as string | undefined };
  const connection = interactiveLaneConnection(bulk.connection, lane.connection, {
    clock,
    laneConnected: () => link.connected,
    laneGeneration: () => link.generation,
    onLaneReconnect: (listener) => {
      reconnects.add(listener);
      return () => reconnects.delete(listener);
    },
    replayScope: () => link.scope,
  });
  const disconnect = (): void => {
    link.connected = false;
    link.generation += 1;
  };
  const reconnect = (): void => {
    link.connected = true;
    link.generation += 1;
    for (const listener of reconnects) listener();
  };
  return { bulk, lane, clock, link, connection, disconnect, reconnect, pendingTimers };
}

describe('interactiveLaneConnection routing', () => {
  it('keeps ordinary calls on the bulk channel and resizes on the lane', () => {
    const { bulk, lane, connection } = setup();
    void connection.call('git.status', {});
    void connection.call('tuiAgents.resize', { conversationId: 'c1', cols: 80, rows: 24 });
    expect(bulk.calls.map((call) => call.path)).toEqual(['git.status']);
    expect(lane.calls.map((call) => call.path)).toEqual(['tuiAgents.resize']);
  });

  it('sends input unchanged to servers that cannot deduplicate it', () => {
    const { lane, link, connection } = setup();
    link.scope = undefined;
    void sendKey(connection, 'c1', 'a');
    expect(lane.calls[0]!.input).toEqual({ conversationId: 'c1', data: 'a' });
  });
});

describe('interactiveLaneConnection active sessions', () => {
  it('keeps only the two most recently typed sessions on the lane', async () => {
    const { bulk, lane, connection } = setup();
    for (const id of ['c1', 'c2', 'c3']) await connection.attach(outputOf(id), () => {});

    for (const id of ['c1', 'c2', 'c3']) void sendKey(connection, id);
    await flush();

    expect(lane.live(outputOf('c1'))).toBeUndefined();
    expect(bulk.live(outputOf('c1'))).toBeDefined();
    expect(lane.live(outputOf('c2'))).toBeDefined();
    expect(lane.live(outputOf('c3'))).toBeDefined();
    expect(bulk.live(outputOf('c3'))).toBeUndefined();
  });

  it('retries a failed demotion so the cap holds once bulk recovers', async () => {
    const { bulk, lane, clock, connection } = setup();
    for (const id of ['c1', 'c2', 'c3']) await connection.attach(outputOf(id), () => {});
    void sendKey(connection, 'c1');
    void sendKey(connection, 'c2');
    await flush();

    bulk.failAttach = true;
    void sendKey(connection, 'c3');
    await flush();
    expect(lane.liveTopics()).toHaveLength(3);

    bulk.failAttach = false;
    await clock.advanceBy(MOVE_RETRY_MS);
    await flush();
    expect(lane.liveTopics().sort()).toEqual([outputOf('c2'), outputOf('c3')].sort());
    expect(bulk.live(outputOf('c1'))).toBeDefined();
  });

  it('returns an idle session to the bulk channel', async () => {
    const { bulk, lane, clock, connection } = setup();
    await connection.attach(outputOf('c1'), () => {});
    void sendKey(connection, 'c1');
    await flush();
    expect(lane.live(outputOf('c1'))).toBeDefined();

    await clock.advanceBy(ACTIVE_IDLE_MS);
    await flush();
    expect(lane.live(outputOf('c1'))).toBeUndefined();
    expect(bulk.live(outputOf('c1'))).toBeDefined();
  });
});

describe('interactiveLaneConnection disposal', () => {
  it('clears failed-move retry timers when the connection disposes', async () => {
    const { bulk, lane, clock, connection, pendingTimers } = setup();
    for (const id of ['c1', 'c2', 'c3']) await connection.attach(outputOf(id), () => {});
    const inputs = [sendKey(connection, 'c1'), sendKey(connection, 'c2')];
    await flush();

    bulk.failAttach = true;
    inputs.push(sendKey(connection, 'c3'));
    await flush();

    const bulkAttempts = bulk.attachAttempts;
    const laneAttempts = lane.attachAttempts;

    const inputSettlements = Promise.allSettled(inputs);
    connection.dispose();
    expect(pendingTimers.size).toBe(0);
    for (const result of await inputSettlements) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'DISCONNECTED' });
      }
    }

    await clock.advanceBy(3_000);
    await flush();

    expect(bulk.attachAttempts).toBe(bulkAttempts);
    expect(lane.attachAttempts).toBe(laneAttempts);
  });

  it('does not schedule a retry when a move rejects after disposal', async () => {
    const { bulk, lane, clock, connection, pendingTimers } = setup();
    for (const id of ['c1', 'c2', 'c3']) await connection.attach(outputOf(id), () => {});
    const inputs = [sendKey(connection, 'c1'), sendKey(connection, 'c2')];
    await flush();

    bulk.holdAttach = true;
    inputs.push(sendKey(connection, 'c3'));
    await flush();

    const bulkAttempts = bulk.attachAttempts;
    const laneAttempts = lane.attachAttempts;

    const inputSettlements = Promise.allSettled(inputs);
    connection.dispose();
    bulk.rejectAttaches(disconnected());
    await flush();
    expect(pendingTimers.size).toBe(0);
    for (const result of await inputSettlements) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'DISCONNECTED' });
      }
    }

    bulk.holdAttach = false;
    await clock.advanceBy(MOVE_RETRY_MS);
    await flush();

    expect(bulk.attachAttempts).toBe(bulkAttempts);
    expect(lane.attachAttempts).toBe(laneAttempts);
  });
});

describe('interactiveLaneConnection migration', () => {
  it('recovers a final chunk still queued on the bulk channel when output then stops', async () => {
    const { bulk, lane, connection } = setup();
    const topic = outputOf('c1');
    const text: string[] = [];
    const store = {
      reset: (data: { text: string }) => text.splice(0, text.length, data.text),
      append: (chunk: string) => text.push(chunk),
    };
    const handle = {
      topic,
      snapshot: () => connection.snapshot(topic),
      attach: (push: (update: LiveUpdate) => void, options?: AttachOptions) =>
        connection.attach(topic, push, options),
    };
    bulk.snapshotData = logSnapshot(0, '');
    const replica = new ReplicaLog(handle as never, { store });
    await replica.ready;
    await flush();
    bulk.live(topic)!.push(updateAt(1, 'a'));

    // 'b' is still queued on the bulk channel; after the move the session stays silent.
    lane.snapshotData = logSnapshot(2, 'ab');
    void sendKey(connection, 'c1');
    await flush();

    expect(bulk.live(topic)).toBeUndefined();
    expect(text.join('')).toBe('ab');
    await replica.dispose();
  });

  it('keeps output applied while an older migration snapshot was in flight', async () => {
    const { bulk, lane, connection } = setup();
    const topic = outputOf('c1');
    const text: string[] = [];
    const store = {
      reset: (data: { text: string }) => text.splice(0, text.length, data.text),
      append: (chunk: string) => text.push(chunk),
    };
    const handle = {
      topic,
      snapshot: () => connection.snapshot(topic),
      attach: (push: (update: LiveUpdate) => void, options?: AttachOptions) =>
        connection.attach(topic, push, options),
    };
    bulk.snapshotData = logSnapshot(0, '');
    const replica = new ReplicaLog(handle as never, { store });
    await replica.ready;
    await flush();
    bulk.live(topic)!.push(updateAt(1, 'a'));

    // Snapshot 1 is captured, update 2 arrives on the lane, then snapshot 1 resolves; silence.
    let releaseSnapshot: () => void = () => {};
    lane.snapshotGate = new Promise((resolve) => (releaseSnapshot = resolve));
    lane.snapshotData = logSnapshot(1, 'a');
    void sendKey(connection, 'c1');
    await flush();
    lane.live(topic)!.push(updateAt(2, 'b'));
    releaseSnapshot();
    await flush();

    expect(text.join('')).toBe('ab');
    await replica.dispose();
  });

  it('moves an output whose first attach was still pending when typing started', async () => {
    const { bulk, lane, connection } = setup();
    bulk.holdAttach = true;
    const attached = connection.attach(outputOf('c1'), () => {});
    void sendKey(connection, 'c1');
    bulk.releaseAttaches();
    await attached;
    await flush();

    expect(lane.live(outputOf('c1'))).toBeDefined();
    expect(bulk.live(outputOf('c1'))).toBeUndefined();
  });

  it('retries a failed move on the next keystroke', async () => {
    const { bulk, lane, connection } = setup();
    await connection.attach(outputOf('c1'), () => {});
    lane.failAttach = true;
    void sendKey(connection, 'c1');
    await flush();
    expect(bulk.live(outputOf('c1'))).toBeDefined();

    lane.failAttach = false;
    void sendKey(connection, 'c1');
    await flush();
    expect(lane.live(outputOf('c1'))).toBeDefined();
    expect(bulk.live(outputOf('c1'))).toBeUndefined();
  });

  it('delivers updates seen on both channels during a move once', async () => {
    const { bulk, lane, connection } = setup();
    const topic = outputOf('c1');
    const received: number[] = [];
    await connection.attach(topic, (update) => received.push(update.sequence));
    const bulkPush = bulk.live(topic)!.push;
    bulkPush(updateAt(1));
    void sendKey(connection, 'c1');
    await flush();
    lane.live(topic)!.push(updateAt(2));
    bulkPush(updateAt(2));
    lane.live(topic)!.push(updateAt(3));
    expect(received).toEqual([1, 2, 3]);
  });
});

describe('interactiveLaneConnection input replay', () => {
  it('resends input rejected by a disconnect in order, marked as replays', async () => {
    const { lane, connection, disconnect, reconnect } = setup();
    const first = sendKey(connection, 'c1', 'a');
    const second = sendKey(connection, 'c1', 'b');
    disconnect();
    for (const call of lane.calls.splice(0)) call.reject(disconnected());
    await flush();
    expect(lane.calls).toHaveLength(0);

    reconnect();
    expect(lane.calls.map((call) => [call.input.data, sequenceOf(call)])).toEqual([
      ['a', { writer: expect.any(String), seq: 0, replay: true }],
      ['b', { writer: expect.any(String), seq: 1, replay: true }],
    ]);
    for (const call of lane.calls) call.resolve({ success: true });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('holds new input until attempts from the old connection settle', async () => {
    const { lane, connection, disconnect, reconnect } = setup();
    void sendKey(connection, 'c1', 'a');
    void sendKey(connection, 'c1', 'b');
    const stale = lane.calls.splice(0);
    disconnect();
    // The reconnect notice arrives before the old attempts are rejected.
    reconnect();
    void sendKey(connection, 'c1', 'c');
    for (const call of stale) call.reject(disconnected());
    await flush();

    expect(lane.calls.map((call) => sequenceOf(call).seq)).toEqual([0, 1, 2]);
  });

  it('refuses to resend input to a different daemon incarnation', async () => {
    const { lane, link, connection, disconnect, reconnect } = setup();
    const pending = sendKey(connection, 'c1', 'a');
    disconnect();
    lane.calls.splice(0)[0]!.reject(disconnected());
    await flush();

    link.scope = 'daemon-1:2';
    reconnect();
    await expect(pending).rejects.toThrow('not confirmed');
    expect(lane.calls).toHaveLength(0);
  });

  it('passes errors other than disconnects to the caller', async () => {
    const { lane, connection } = setup();
    const sent = sendKey(connection, 'c1', 'a');
    lane.calls[0]!.reject(new WireError('HANDLER_ERROR', 'boom'));
    await expect(sent).rejects.toThrow('boom');
  });
});

describe('interactiveLaneConnection input while the lane is disconnected', () => {
  const key = (
    connection: Connection,
    data: string,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ) => connection.call('tuiAgents.sendInput', { conversationId: 'c1', data }, options);
  const settleState = (promise: Promise<unknown>) => {
    const state = { value: 'pending' as string };
    promise.then(
      () => (state.value = 'resolved'),
      (error: unknown) => (state.value = error instanceof WireError ? error.code : 'error')
    );
    return state;
  };
  const cut = async (lane: FakeConnection, disconnect: () => void) => {
    disconnect();
    for (const call of lane.calls.splice(0)) call.reject(disconnected());
    await flush();
  };

  it('rejects cancelled input at once and never replays it', async () => {
    const { lane, connection, disconnect, reconnect } = setup();
    const kept = key(connection, 'a');
    await cut(lane, disconnect);
    const controller = new AbortController();
    const cancelled = key(connection, 'b', { signal: controller.signal });
    const state = settleState(cancelled);
    controller.abort();
    await flush();

    expect(state.value).toBe('CANCELLED');
    reconnect();
    expect(lane.calls.map((call) => call.input.data)).toEqual(['a']);
    lane.calls[0]!.resolve({ success: true });
    await kept;
  });

  it('frees the buffer slot of cancelled input', async () => {
    const { lane, connection, disconnect } = setup();
    void key(connection, 'a');
    await cut(lane, disconnect);
    const states: Array<{ value: string }> = [];
    for (let index = 0; index < 1100; index++) {
      const controller = new AbortController();
      states.push(settleState(key(connection, 'x', { signal: controller.signal })));
      controller.abort();
    }
    await flush();

    expect(states.every((state) => state.value === 'CANCELLED')).toBe(true);
  });

  it('rejects input whose signal was already aborted', async () => {
    const { connection } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(key(connection, 'a', { signal: controller.signal })).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('expires queued input at its timeout and does not replay it', async () => {
    const { lane, clock, connection, disconnect, reconnect } = setup();
    void key(connection, 'a');
    await cut(lane, disconnect);
    const state = settleState(key(connection, 'b', { timeoutMs: 1_000 }));
    await clock.advanceBy(1_000);
    await flush();

    expect(state.value).toBe('TIMEOUT');
    reconnect();
    expect(lane.calls.map((call) => call.input.data)).toEqual(['a']);
  });

  it('passes only the remaining timeout to a later attempt', async () => {
    const { lane, clock, connection, disconnect, reconnect } = setup();
    void key(connection, 'a', { timeoutMs: 1_000 });
    expect(lane.calls[0]!.options?.timeoutMs).toBe(1_000);
    await cut(lane, disconnect);
    await clock.advanceBy(300);
    reconnect();

    expect(lane.calls).toHaveLength(1);
    expect(lane.calls[0]!.options?.timeoutMs).toBe(700);
  });

  it('releases timers and abort listeners when input settles or the connection disposes', async () => {
    const { lane, connection, disconnect, reconnect, pendingTimers } = setup();
    const controller = new AbortController();
    let added = 0;
    let removed = 0;
    const addListener = controller.signal.addEventListener.bind(controller.signal);
    const removeListener = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((...args: Parameters<typeof addListener>) => {
      added += 1;
      addListener(...args);
    }) as typeof addListener;
    controller.signal.removeEventListener = ((...args: Parameters<typeof removeListener>) => {
      removed += 1;
      removeListener(...args);
    }) as typeof removeListener;

    const plain = key(connection, 'p');
    lane.calls[0]!.resolve({ success: true });
    await plain;
    lane.calls.length = 0;
    const baseline = pendingTimers.size;

    const settled = key(connection, 'a', { signal: controller.signal, timeoutMs: 5_000 });
    await cut(lane, disconnect);
    reconnect();
    lane.calls[0]!.resolve({ success: true });
    await settled;
    expect(pendingTimers.size).toBe(baseline);
    expect(removed).toBe(added);
    expect(added).toBeGreaterThan(0);

    const queued = key(connection, 'b', { timeoutMs: 5_000 });
    const state = settleState(queued);
    connection.dispose();
    await flush();
    expect(state.value).toBe('DISCONNECTED');
    expect(pendingTimers.size).toBe(0);
  });
});

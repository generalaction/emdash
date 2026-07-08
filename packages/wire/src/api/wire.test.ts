import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveModel } from '../live/model';
import type { LiveSource, LiveUpdate } from '../live/protocol';
import { bindContract, encodeTopic } from './bind';
import { connect } from './connect';
import { defineContract, liveModel, procedure } from './define';
import { WireError, WIRE_CANCELLED_CODE } from './protocol';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const contract = defineContract({
  greet: procedure({ input: z.object({ name: z.string() }), output: z.string() }),
  fail: procedure({ input: z.void().optional(), output: z.void() }),
  state: liveModel({ key: z.object({ id: z.string() }), data: z.object({ count: z.number() }) }),
});

function setup() {
  const pair = memoryTransportPair();
  const model = new LiveModel({ count: 0 }, 1000);
  const controller = bindContract(contract, {
    greet: ({ name }) => `hello ${name}`,
    fail: () => {
      throw new WireError('EXPECTED', 'expected failure');
    },
    state: ({ id }) => (id === 'known' ? model : null),
  });
  const disposeServer = serve(pair.right, controller);
  const connection = connect(pair.left);
  return { pair, connection, model, disposeServer };
}

describe('wire serve/connect', () => {
  it('calls procedures and propagates errors', async () => {
    const { connection } = setup();
    await expect(connection.call('greet', { name: 'wire' })).resolves.toBe('hello wire');
    await expect(connection.call('fail', undefined)).rejects.toMatchObject({ code: 'EXPECTED' });
  });

  it('snapshots and subscribes to live sources with refcounted detach', async () => {
    const { connection, model } = setup();
    const topic = encodeTopic(contract.state.id, { id: 'known' });
    await expect(connection.snapshot(topic)).resolves.toMatchObject({ data: { count: 0 } });

    const updates: LiveUpdate[] = [];
    const detach = await connection.attach(topic, (update) => updates.push(update));
    model.produce((draft) => {
      draft.count = 1;
    });
    await waitFor(() => updates.length === 1);
    detach();
    model.produce((draft) => {
      draft.count = 2;
    });
    await Promise.resolve();
    expect(updates).toHaveLength(1);
  });

  it('surfaces attach failures for unknown topics', async () => {
    const { connection } = setup();
    await expect(connection.attach('missing.topic', () => {})).rejects.toMatchObject({
      code: 'UNKNOWN_TOPIC',
    });
  });

  it('cleans server subscriptions on disconnect', async () => {
    let detachCount = 0;
    const source: LiveSource = {
      snapshot: () => ({ generation: 1, sequence: 0, timestamp: 0, data: {} }),
      subscribe: () => {
        return () => {
          detachCount += 1;
        };
      },
    };
    const pair = memoryTransportPair();
    const cleanupContract = defineContract({
      state: liveModel({ key: z.void().optional(), data: z.object({}) }),
    });
    const controller = bindContract(cleanupContract, { state: () => source });
    serve(pair.right, controller);
    const connection = connect(pair.left);
    await connection.attach(encodeTopic(cleanupContract.state.id, undefined), () => {});
    pair.disconnect();
    expect(detachCount).toBe(1);
  });

  it('re-attaches active topics after reconnect notification', async () => {
    const { connection, pair, model } = setup();
    const topic = encodeTopic(contract.state.id, { id: 'known' });
    const updates: LiveUpdate[] = [];
    await connection.attach(topic, (update) => updates.push(update));
    pair.left.disconnect();
    await expect(connection.call('greet', { name: 'after' })).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
    expect(() => {
      model.produce((draft) => {
        draft.count = 1;
      });
    }).not.toThrow();
  });

  it('cancels an in-flight call with a caller signal', async () => {
    let aborted = false;
    let started = false;
    const pair = memoryTransportPair();
    const slowContract = defineContract({
      slow: procedure({ input: z.void().optional(), output: z.string() }),
    });
    const controller = bindContract(slowContract, {
      slow: (_input, meta) =>
        new Promise<string>((resolve, reject) => {
          started = true;
          if (meta.signal?.aborted) {
            aborted = true;
            reject(new Error('aborted'));
            return;
          }
          meta.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
          setTimeout(() => resolve('late'), 10);
        }),
    });
    const serverEvents: unknown[] = [];
    serve(pair.right, controller, {
      instrumentation: {
        cancel: (event) => serverEvents.push({ kind: 'cancel', event }),
        callEnd: (event) => serverEvents.push({ kind: 'callEnd', event }),
      },
    });
    const connection = connect(pair.left);
    const abort = new AbortController();

    const result = connection.call('slow', undefined, { signal: abort.signal });
    await waitFor(() => started);
    abort.abort();

    await expect(result).rejects.toMatchObject({ code: WIRE_CANCELLED_CODE });
    await waitFor(() => aborted);
    expect(serverEvents).toContainEqual({
      kind: 'cancel',
      event: expect.objectContaining({ callId: expect.any(String), side: 'server' }),
    });
    expect(serverEvents).toContainEqual({
      kind: 'callEnd',
      event: expect.objectContaining({
        ok: false,
        errorCode: WIRE_CANCELLED_CODE,
        side: 'server',
      }),
    });
  });

  it('rejects pre-aborted calls without posting', async () => {
    const { connection } = setup();
    const abort = new AbortController();
    abort.abort();

    await expect(
      connection.call('greet', { name: 'wire' }, { signal: abort.signal })
    ).rejects.toMatchObject({
      code: WIRE_CANCELLED_CODE,
    });
  });

  it('aborts in-flight calls when the transport disconnects', async () => {
    let aborted = false;
    let started = false;
    const pair = memoryTransportPair();
    const slowContract = defineContract({
      slow: procedure({ input: z.void().optional(), output: z.string() }),
    });
    const controller = bindContract(slowContract, {
      slow: (_input, meta) =>
        new Promise<string>((resolve, reject) => {
          started = true;
          if (meta.signal?.aborted) {
            aborted = true;
            reject(new Error('aborted'));
            return;
          }
          meta.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
          setTimeout(() => resolve('late'), 10);
        }),
    });
    serve(pair.right, controller);
    const connection = connect(pair.left);

    const result = connection.call('slow', undefined);
    await waitFor(() => started);
    pair.disconnect();

    await expect(result).rejects.toMatchObject({ code: 'DISCONNECTED' });
    await waitFor(() => aborted);
  });

  it('ignores a late result after local cancellation', async () => {
    const gate = deferred<string>();
    const pair = memoryTransportPair();
    const slowContract = defineContract({
      slow: procedure({ input: z.void().optional(), output: z.string() }),
    });
    const controller = bindContract(slowContract, { slow: () => gate.promise });
    serve(pair.right, controller);
    const connection = connect(pair.left);
    const abort = new AbortController();

    const result = connection.call('slow', undefined, { signal: abort.signal });
    abort.abort();

    await expect(result).rejects.toMatchObject({ code: WIRE_CANCELLED_CODE });
    gate.resolve('late');
    await Promise.resolve();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

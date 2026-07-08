import { err, ok, type Unsubscribe } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveModel } from '../live/model';
import type { LiveSource, LiveUpdate } from '../live/protocol';
import { bindContract, encodeTopic } from './bind';
import { contractClient } from './client';
import { connect } from './connect';
import { defineContract, fallible, liveModel, procedure } from './define';
import { isWireError, WireError } from './protocol';
import { serve } from './serve';
import { memoryTransportPair, reconnectingTransport } from './transports';

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
      throw new WireError('NOT_FOUND', 'expected failure');
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
    await expect(connection.call('fail', undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('round-trips uncaught handler errors as HANDLER_ERROR with a serialized cause', async () => {
    const pair = memoryTransportPair();
    const failingContract = defineContract({
      fail: procedure({ input: z.void().optional(), output: z.void() }),
    });
    const controller = bindContract(failingContract, {
      fail: () => {
        throw new TypeError('boom');
      },
    });
    serve(pair.right, controller);
    const connection = connect(pair.left);

    await expect(connection.call('fail', undefined)).rejects.toMatchObject({
      code: 'HANDLER_ERROR',
      message: 'boom',
      cause: {
        name: 'TypeError',
        message: 'boom',
      },
    });
  });

  it('preserves serialized causes on thrown wire errors', async () => {
    const pair = memoryTransportPair();
    const failingContract = defineContract({
      fail: procedure({ input: z.void().optional(), output: z.void() }),
    });
    const cause = new Error('root cause');
    const controller = bindContract(failingContract, {
      fail: () => {
        throw new WireError('NOT_FOUND', 'missing resource', { cause });
      },
    });
    serve(pair.right, controller);
    const connection = connect(pair.left);

    await expect(connection.call('fail', undefined)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'missing resource',
      cause: {
        name: 'Error',
        message: 'root cause',
      },
    });
  });

  it('narrows wire errors with and without a code argument', () => {
    const error: unknown = new WireError('CANCELLED', 'cancelled');

    expect(isWireError(error)).toBe(true);
    expect(isWireError(error, 'CANCELLED')).toBe(true);
    expect(isWireError(error, 'DISCONNECTED')).toBe(false);
    expect(isWireError(new Error('plain'))).toBe(false);
  });

  it('supports fallible procedures that return typed Result payloads', async () => {
    const pair = memoryTransportPair();
    const fallibleContract = defineContract({
      load: fallible({
        input: z.object({ id: z.string() }),
        data: z.object({ value: z.string() }),
        error: z.object({ type: z.literal('missing') }),
      }),
    });
    const controller = bindContract(
      fallibleContract,
      {
        load: ({ id }) =>
          id === 'known' ? ok({ value: 'found' }) : err({ type: 'missing' as const }),
      },
      { validate: 'full' }
    );
    serve(pair.right, controller);
    const connection = connect(pair.left);

    await expect(connection.call('load', { id: 'known' })).resolves.toEqual(ok({ value: 'found' }));
    await expect(connection.call('load', { id: 'missing' })).resolves.toEqual(
      err({ type: 'missing' })
    );
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

  it('removes failed attachment entries so later attaches can retry the topic', async () => {
    const pair = memoryTransportPair();
    let available = false;
    let resolveCount = 0;
    const source: LiveSource = {
      snapshot: () => ({ generation: 1, sequence: 0, timestamp: 0, data: {} }),
      subscribe: () => () => {},
    };
    const controller = {
      call: () => {
        throw new WireError('UNKNOWN_PROCEDURE', 'not implemented');
      },
      liveRefIds: () => ['dynamic.topic'],
      resolveLive: (topic: string) => {
        resolveCount += 1;
        return available && topic === 'dynamic.topic' ? source : null;
      },
    };
    serve(pair.right, controller);
    const connection = connect(pair.left);

    await expect(connection.attach('dynamic.topic', () => {})).rejects.toMatchObject({
      code: 'UNKNOWN_TOPIC',
    });

    available = true;
    const detach = await connection.attach('dynamic.topic', () => {});
    expect(resolveCount).toBe(2);
    detach();
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

  it('does not throw when an attachment is detached after disconnect', async () => {
    const { connection, pair, model } = setup();
    const topic = encodeTopic(contract.state.id, { id: 'known' });
    const updates: LiveUpdate[] = [];
    const detach = await connection.attach(topic, (update) => updates.push(update));
    pair.left.disconnect();
    await expect(connection.call('greet', { name: 'after' })).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
    expect(() => {
      model.produce((draft) => {
        draft.count = 1;
      });
    }).not.toThrow();
    expect(() => detach()).not.toThrow();
  });

  it('reattaches and refreshes bound live models after reconnect', async () => {
    const model = new LiveModel({ count: 0 }, 1000);
    const controller = bindContract(contract, {
      greet: ({ name }) => `hello ${name}`,
      fail: () => {
        throw new WireError('NOT_FOUND', 'expected failure');
      },
      state: ({ id }) => (id === 'known' ? model : null),
    });
    const pairs: ReturnType<typeof memoryTransportPair>[] = [];
    const serverDisposers: Unsubscribe[] = [];
    const transport = reconnectingTransport(async () => {
      const pair = memoryTransportPair();
      pairs.push(pair);
      serverDisposers.push(serve(pair.right, controller));
      return pair.left;
    });
    const client = contractClient(contract, connect(transport));
    const seen: Array<{ count: number }> = [];
    const binding = client.state({ id: 'known' }, (value) => seen.push(value));

    await binding.ready;
    model.produce((draft) => {
      draft.count = 1;
    });
    await waitFor(() => binding.client.getSnapshot()?.count === 1);

    pairs[0]?.disconnect();
    model.reseed({ count: 9 });

    await waitFor(() => pairs.length === 2);
    await waitFor(() => binding.client.getSnapshot()?.count === 9);
    expect(seen.at(-1)).toEqual({ count: 9 });

    await binding.dispose();
    transport.close();
    for (const dispose of serverDisposers) dispose();
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

    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    await waitFor(() => aborted);
    expect(serverEvents).toContainEqual({
      kind: 'cancel',
      event: expect.objectContaining({ callId: expect.any(String), side: 'server' }),
    });
    expect(serverEvents).toContainEqual({
      kind: 'callEnd',
      event: expect.objectContaining({
        ok: false,
        errorCode: 'CANCELLED',
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
      code: 'CANCELLED',
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

    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
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

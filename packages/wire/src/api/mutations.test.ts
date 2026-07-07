import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGroupInstance, LiveModelRegistry } from '../live';
import type { WireInstrumentation } from '../observability';
import { bindContract, fromRegistry } from './bind';
import { contractClient } from './client';
import { connect } from './connect';
import { defineContract, liveModel, liveModelGroup, mutation } from './define';
import { serve } from './serve';
import { memoryTransportPair, reconnectingTransport, type MemoryTransportPair } from './transports';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });

function setup(instrumentation?: WireInstrumentation) {
  let handlerCalls = 0;
  const contract = createCounterContract((ctx, input) => {
    handlerCalls += 1;
    ctx.produce('left', (draft) => {
      (draft as { count: number }).count += 1;
    });
    const touched = ['left'];
    if ((input as { touchRight: boolean }).touchRight) {
      ctx.produce('right', (draft) => {
        (draft as { count: number }).count += 1;
      });
      touched.push('right');
    }
    return ok({ touched });
  });
  const registry = new LiveModelRegistry();
  const key = { id: 'shared' };
  const instance = createGroupInstance(contract.counter, key, {
    left: { count: 0 },
    right: { count: 10 },
  });
  registry.registerGroup(contract.counter, key, instance);
  const pair = memoryTransportPair();
  const controller = bindContract(contract, {
    registry,
    instrumentation,
    impl: {
      counter: fromRegistry(),
    },
  });
  serve(pair.right, controller);
  return {
    client: contractClient(contract, connect(pair.left)),
    key,
    left: instance.models.left,
    right: instance.models.right,
    calls: () => handlerCalls,
  };
}

describe('live model group mutations', () => {
  it('settles only the live models actually touched by a mutation', async () => {
    const { client, key } = setup();
    const counter = client.counter(key);
    await counter.ready;

    const first = await counter.bump({ touchRight: false });
    expect(first.result).toMatchObject({ success: true, data: { data: { touched: ['left'] } } });
    await first.settled;
    expect(counter.left.client.getSnapshot()).toEqual({ count: 1 });
    expect(counter.right.client.getSnapshot()).toEqual({ count: 10 });

    const second = await counter.bump({ touchRight: true });
    await second.settled;
    expect(counter.left.client.getSnapshot()).toEqual({ count: 2 });
    expect(counter.right.client.getSnapshot()).toEqual({ count: 11 });
  });

  it('settles immediately for touched models that are not locally bound', async () => {
    const { client, key } = setup();
    const counter = client.counter(key, { left: () => {} });
    await counter.left.ready;

    await counter.right.dispose();
    const invocation = await counter.bump({ touchRight: true });
    await invocation.settled;
    expect(counter.left.client.getSnapshot()).toEqual({ count: 1 });
  });

  it('dedupes duplicate group mutation ids', async () => {
    const dedupes: unknown[] = [];
    const { client, key, left, calls } = setup({
      mutationDeduped: (event) => dedupes.push(event),
    });
    const counter = client.counter(key);
    await counter.ready;

    const first = await counter.bump({ touchRight: false }, { mutationId: 'same' });
    const second = await counter.bump({ touchRight: false }, { mutationId: 'same' });

    expect(first.result).toEqual(second.result);
    expect(left.snapshot().data).toEqual({ count: 1 });
    expect(calls()).toBe(1);
    expect(dedupes).toEqual([{ mutationId: 'same', path: 'counter.bump' }]);
  });

  it('retries disconnected mutations with the same mutation id', async () => {
    let handlerCalls = 0;
    const gate = deferred<void>();
    const contract = createCounterContract(async (ctx) => {
      handlerCalls += 1;
      ctx.produce('left', (draft) => {
        (draft as { count: number }).count += 1;
      });
      await gate.promise;
      return ok({ touched: ['left'] });
    });
    const registry = new LiveModelRegistry();
    const key = { id: 'shared' };
    const instance = createGroupInstance(contract.counter, key, {
      left: { count: 0 },
      right: { count: 0 },
    });
    registry.registerGroup(contract.counter, key, instance);
    let currentPair: MemoryTransportPair | undefined;
    const controller = bindContract(contract, {
      registry,
      impl: {
        counter: fromRegistry(),
      },
    });
    const transport = reconnectingTransport(
      async () => {
        currentPair = memoryTransportPair();
        serve(currentPair.right, controller);
        return currentPair.left;
      },
      { backoffMs: [0] }
    );
    const client = contractClient(contract, connect(transport));
    const counter = client.counter(key);
    await counter.ready;

    const invocation = counter.bump(
      { touchRight: false },
      { mutationId: 'retry-mutation', retry: { maxRetries: 1 } }
    );
    await waitFor(() => handlerCalls === 1 && currentPair !== undefined);
    currentPair?.disconnect();
    gate.resolve();

    await expect(invocation).resolves.toMatchObject({
      result: { success: true },
    });
    expect(instance.models.left.snapshot().data).toEqual({ count: 1 });
    expect(handlerCalls).toBe(1);
  });
});

function createCounterContract(handler: Parameters<typeof mutation>[1]) {
  return defineContract({
    counter: liveModelGroup({
      key: keySchema,
      models: {
        left: liveModel({ data: stateSchema }),
        right: liveModel({ data: stateSchema }),
      },
      mutations: {
        bump: mutation(
          {
            input: z.object({ touchRight: z.boolean() }),
            data: z.object({ touched: z.array(z.string()) }),
            error: z.string(),
          },
          handler
        ),
      },
    }),
  });
}

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

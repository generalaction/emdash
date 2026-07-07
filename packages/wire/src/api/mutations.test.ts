import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveModelRegistry, LiveModelServer } from '../live';
import { bindContract, fromRegistry } from './bind';
import { contractClient } from './client';
import { connect } from './connect';
import { defineContract, liveModel, mutation } from './define';
import { serve } from './serve';
import { memoryTransportPair, reconnectingTransport, type MemoryTransportPair } from './transports';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });

const contract = defineContract({
  left: liveModel({ key: keySchema, data: stateSchema }),
  right: liveModel({ key: keySchema, data: stateSchema }),
  bump: mutation({
    input: keySchema.extend({ touchRight: z.boolean() }),
    data: z.object({ touched: z.array(z.string()) }),
    error: z.string(),
  }),
});

function setup() {
  const registry = new LiveModelRegistry();
  const left = new LiveModelServer({ count: 0 }, 1000);
  const right = new LiveModelServer({ count: 10 }, 2000);
  const key = { id: 'shared' };
  registry.register(contract.left, key, left);
  registry.register(contract.right, key, right);
  const pair = memoryTransportPair();
  let handlerCalls = 0;
  const controller = bindContract(contract, {
    registry,
    impl: {
      left: fromRegistry(),
      right: fromRegistry(),
      bump: (ctx, input) => {
        handlerCalls += 1;
        ctx.produce(contract.left, { id: input.id }, (draft) => {
          draft.count += 1;
        });
        const touched = ['left'];
        if (input.touchRight) {
          ctx.produce(contract.right, { id: input.id }, (draft) => {
            draft.count += 1;
          });
          touched.push('right');
        }
        return ok({ touched });
      },
    },
  });
  serve(pair.right, controller);
  return {
    client: contractClient(contract, connect(pair.left)),
    key,
    left,
    right,
    calls: () => handlerCalls,
  };
}

describe('contract mutations', () => {
  it('settles only the live models actually touched by a mutation', async () => {
    const { client, key } = setup();
    const leftBinding = client.left(key, () => {});
    const rightBinding = client.right(key, () => {});
    await Promise.all([leftBinding.ready, rightBinding.ready]);

    const first = await client.bump({ ...key, touchRight: false });
    expect(first.result).toMatchObject({ success: true, data: { data: { touched: ['left'] } } });
    await first.settled;
    expect(leftBinding.client.getSnapshot()).toEqual({ count: 1 });
    expect(rightBinding.client.getSnapshot()).toEqual({ count: 10 });

    const second = await client.bump({ ...key, touchRight: true });
    await second.settled;
    expect(leftBinding.client.getSnapshot()).toEqual({ count: 2 });
    expect(rightBinding.client.getSnapshot()).toEqual({ count: 11 });
  });

  it('settles immediately for touched models that are not locally bound', async () => {
    const { client, key } = setup();
    const leftBinding = client.left(key, () => {});
    await leftBinding.ready;

    const invocation = await client.bump({ ...key, touchRight: true });
    await invocation.settled;
    expect(leftBinding.client.getSnapshot()).toEqual({ count: 1 });
  });

  it('dedupes duplicate top-level mutation ids', async () => {
    const { client, key, left, calls } = setup();

    const first = await client.bump({ ...key, touchRight: false }, { mutationId: 'same' });
    const second = await client.bump({ ...key, touchRight: false }, { mutationId: 'same' });

    expect(first.result).toEqual(second.result);
    expect(left.snapshot().data).toEqual({ count: 1 });
    expect(calls()).toBe(1);
  });

  it('retries disconnected mutations with the same mutation id', async () => {
    const registry = new LiveModelRegistry();
    const model = new LiveModelServer({ count: 0 }, 1000);
    const key = { id: 'shared' };
    registry.register(contract.left, key, model);
    registry.register(contract.right, key, new LiveModelServer({ count: 0 }, 2000));
    const gate = deferred<void>();
    let handlerCalls = 0;
    let currentPair: MemoryTransportPair | undefined;
    const controller = bindContract(contract, {
      registry,
      impl: {
        left: fromRegistry(),
        right: fromRegistry(),
        bump: async (ctx, input) => {
          handlerCalls += 1;
          ctx.produce(contract.left, { id: input.id }, (draft) => {
            draft.count += 1;
          });
          await gate.promise;
          return ok({ touched: ['left'] });
        },
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

    const invocation = client.bump(
      { ...key, touchRight: false },
      { mutationId: 'retry-mutation', retry: { maxRetries: 1 } }
    );
    await waitFor(() => handlerCalls === 1 && currentPair !== undefined);
    currentPair?.disconnect();
    gate.resolve();

    await expect(invocation).resolves.toMatchObject({
      result: { success: true },
    });
    expect(model.snapshot().data).toEqual({ count: 1 });
    expect(handlerCalls).toBe(1);
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

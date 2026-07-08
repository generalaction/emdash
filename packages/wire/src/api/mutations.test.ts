import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLiveModelHost, createLiveModelReplica } from '../live';
import type { WireInstrumentation } from '../observability';
import { bindContract } from './bind';
import type { ThinGroup } from './client';
import { client } from './client';
import { connect } from './connect';
import {
  defineContract,
  defineLiveModelContract,
  mutation,
  type GroupKey,
  type GroupMutationHandler,
  type LiveModelGroupDef,
} from './define';
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
  const key = { id: 'shared' };
  const host = createLiveModelHost(contract.counter);
  const instance = host.create(key, {
    left: { count: 0 },
    right: { count: 10 },
  });
  const pair = memoryTransportPair();
  const controller = bindContract(
    contract,
    {
      counter: host,
    },
    {
      instrumentation,
    }
  );
  serve(pair.right, controller);
  return {
    client: client(contract, connect(pair.left)),
    key,
    left: instance.models.left,
    right: instance.models.right,
    calls: () => handlerCalls,
  };
}

describe('live model group mutations', () => {
  it('settles only the live models actually touched by a mutation', async () => {
    const { client, key } = setup();
    const { instance: counter, dispose } = await acquireCounter(client.counter, key);

    const first = await counter.mutations.bump({ touchRight: false });
    expect(first.result).toMatchObject({ success: true, data: { data: { touched: ['left'] } } });
    await first.settled;
    expect(counter.models.left.current()).toEqual({ count: 1 });
    expect(counter.models.right.current()).toEqual({ count: 10 });

    const second = await counter.mutations.bump({ touchRight: true });
    await second.settled;
    expect(counter.models.left.current()).toEqual({ count: 2 });
    expect(counter.models.right.current()).toEqual({ count: 11 });
    await dispose();
  });

  it('settles touched models through the materialized instance', async () => {
    const { client, key } = setup();
    const { instance: counter, dispose } = await acquireCounter(client.counter, key);
    await counter.models.left.ready;

    const invocation = await counter.mutations.bump({ touchRight: true });
    await invocation.settled;
    expect(counter.models.left.current()).toEqual({ count: 1 });
    expect(counter.models.right.current()).toEqual({ count: 11 });
    await dispose();
  });

  it('dedupes duplicate group mutation ids', async () => {
    const dedupes: unknown[] = [];
    const { client, key, left, calls } = setup({
      mutationDeduped: (event) => dedupes.push(event),
    });
    const { instance: counter, dispose } = await acquireCounter(client.counter, key);

    const first = await counter.mutations.bump({ touchRight: false }, { mutationId: 'same' });
    const second = await counter.mutations.bump({ touchRight: false }, { mutationId: 'same' });

    expect(first.result).toEqual(second.result);
    expect(left.snapshot().data).toEqual({ count: 1 });
    expect(calls()).toBe(1);
    expect(dedupes).toEqual([{ mutationId: 'same', path: 'counter.bump' }]);
    await dispose();
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
    const key = { id: 'shared' };
    const host = createLiveModelHost(contract.counter);
    const instance = host.create(key, {
      left: { count: 0 },
      right: { count: 0 },
    });
    let currentPair: MemoryTransportPair | undefined;
    const controller = bindContract(contract, { counter: host });
    const transport = reconnectingTransport(
      async () => {
        currentPair = memoryTransportPair();
        serve(currentPair.right, controller);
        return currentPair.left;
      },
      { backoffMs: [0] }
    );
    const thin = client(contract, connect(transport));
    const { instance: counter, dispose } = await acquireCounter(thin.counter, key);

    const invocation = counter.mutations.bump(
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
    await dispose();
    transport.close();
  });
});

async function acquireCounter<Group extends LiveModelGroupDef>(
  group: ThinGroup<Group>,
  key: GroupKey<Group>
) {
  const replica = createLiveModelReplica(group.def, group);
  const lease = replica.acquire(key);
  const instance = await lease.ready();
  return {
    instance,
    async dispose() {
      await lease.release();
      await replica.dispose();
    },
  };
}

function createCounterContract(
  handler: GroupMutationHandler<
    z.ZodObject<{ touchRight: z.ZodBoolean }>,
    z.ZodObject<{ touched: z.ZodArray<z.ZodString> }>,
    z.ZodString
  >
) {
  return defineContract({
    counter: defineLiveModelContract({
      key: keySchema,
      models: {
        left: stateSchema,
        right: stateSchema,
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

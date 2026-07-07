import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  LiveModelRegistry,
  LiveModelServer,
  bindContract,
  connect,
  contractClient,
  defineContract,
  fromRegistry,
  liveModel,
  memoryTransportPair,
  mutation,
  reconnectingTransport,
  serve,
  type MemoryTransportPair,
} from '../../src/index';

const keySchema = z.object({ id: z.string() });

const api = defineContract({
  counter: liveModel({
    key: keySchema,
    data: z.object({ count: z.number() }),
  }),
  increment: mutation({
    input: keySchema,
    data: z.object({ count: z.number() }),
    error: z.string(),
  }),
});

async function main(): Promise<void> {
  const registry = new LiveModelRegistry();
  const key = { id: 'shared' };
  const counter = new LiveModelServer({ count: 0 }, 1000);
  registry.register(api.counter, key, counter);

  const gate = deferred<void>();
  let currentPair: MemoryTransportPair | undefined;
  let handlerCalls = 0;
  const controller = bindContract(api, {
    registry,
    impl: {
      counter: fromRegistry(),
      increment: async (ctx, input) => {
        handlerCalls += 1;
        ctx.produce(api.counter, { id: input.id }, (draft) => {
          draft.count += 1;
        });
        await gate.promise;
        return ok(counter.snapshot().data);
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
  const client = contractClient(api, connect(transport));

  const invocation = client.increment(key, {
    mutationId: 'example-mutation',
    retry: { maxRetries: 1 },
  });
  await waitFor(() => handlerCalls === 1 && currentPair !== undefined);
  currentPair?.disconnect();
  gate.resolve();

  const result = await invocation;
  console.log('mutation result:', result.result);
  console.log('handler calls:', handlerCalls);
  console.log('counter:', counter.snapshot().data);
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

void main();

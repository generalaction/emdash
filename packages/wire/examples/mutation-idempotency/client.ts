import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  createController,
  client,
  connect,
  createLiveModelReplica,
  createLiveModelHost,
  defineContract,
  liveModel,
  liveState,
  memoryTransportPair,
  mutation,
  serve,
} from '../../src/index';

const keySchema = z.object({ id: z.string() });

async function main(): Promise<void> {
  const api = createApi();
  const key = { id: 'shared' };
  const counters = createLiveModelHost(api.counter);
  const counter = counters.create(key, {
    state: { count: 0 },
  });

  const controller = createController(api, { counter: counters });
  const pair = memoryTransportPair();
  serve(pair.right, controller);
  const contractClient = client(api, connect(pair.left));
  const replica = createLiveModelReplica(api.counter, contractClient.counter);
  const lease = replica.acquire(key);
  const binding = await lease.ready();

  const first = await binding.mutations.increment(
    {},
    {
      mutationId: 'example-mutation',
    }
  );
  const second = await binding.mutations.increment(
    {},
    {
      mutationId: 'example-mutation',
    }
  );

  console.log('first result:', first.result);
  console.log('second result:', second.result);
  console.log('counter:', counter.states.state.snapshot().data);
  await lease.release();
  await replica.dispose();
}

function createApi() {
  return defineContract({
    counter: liveModel({
      key: keySchema,
      states: {
        state: liveState({ data: z.object({ count: z.number() }) }),
      },
      mutations: {
        increment: mutation(
          {
            input: z.object({}),
            data: z.object({ count: z.number() }),
            error: z.string(),
          },
          (ctx) => {
            let count = 0;
            ctx.produce('state', (draft) => {
              const state = draft as { count: number };
              state.count += 1;
              count = state.count;
            });
            return ok({ count });
          }
        ),
      },
    }),
  });
}

void main();

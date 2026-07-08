import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  bindContract,
  connect,
  contractClient,
  createLiveModelHost,
  defineContract,
  defineLiveModelContract,
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

  const controller = bindContract(api, { counter: counters });
  const pair = memoryTransportPair();
  serve(pair.right, controller);
  const client = contractClient(api, connect(pair.left));
  const binding = client.counter(key);
  await binding.ready;

  const first = await binding.increment(
    {},
    {
      mutationId: 'example-mutation',
    }
  );
  const second = await binding.increment(
    {},
    {
      mutationId: 'example-mutation',
    }
  );

  console.log('first result:', first.result);
  console.log('second result:', second.result);
  console.log('counter:', counter.models.state.snapshot().data);
}

function createApi() {
  return defineContract({
    counter: defineLiveModelContract({
      key: keySchema,
      models: {
        state: z.object({ count: z.number() }),
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

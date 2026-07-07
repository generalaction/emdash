import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  LiveModelRegistry,
  bindContract,
  connect,
  contractClient,
  createGroupInstance,
  defineContract,
  fromRegistry,
  liveModel,
  liveModelGroup,
  memoryTransportPair,
  mutation,
  serve,
} from '../../src/index';

const keySchema = z.object({ id: z.string() });

async function main(): Promise<void> {
  const api = createApi();
  const registry = new LiveModelRegistry();
  const key = { id: 'shared' };
  const counter = createGroupInstance(api.counter, key, {
    state: { count: 0 },
  });
  registry.registerGroup(api.counter, key, counter);

  const controller = bindContract(api, {
    registry,
    impl: {
      counter: fromRegistry(),
    },
  });
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
    counter: liveModelGroup({
      key: keySchema,
      models: {
        state: liveModel({
          data: z.object({ count: z.number() }),
        }),
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

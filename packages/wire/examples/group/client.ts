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

const conversationKeySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ title: z.string() });
const usageSchema = z.object({ tokens: z.number() });

const api = defineContract({
  conversation: liveModelGroup({
    key: conversationKeySchema,
    models: {
      state: liveModel({ data: stateSchema }),
      usage: liveModel({ data: usageSchema }),
    },
    mutations: {
      setTitle: mutation(
        { input: z.object({ title: z.string() }), data: z.void(), error: z.string() },
        (ctx, input) => {
          ctx.produce('state', (draft) => {
            (draft as { title: string }).title = input.title;
          });
          ctx.produce('usage', (draft) => {
            (draft as { tokens: number }).tokens += input.title.length;
          });
          return ok(undefined);
        }
      ),
    },
  }),
});

async function main(): Promise<void> {
  const key = { conversationId: 'demo' };
  const registry = new LiveModelRegistry();
  const instance = createGroupInstance(api.conversation, key, {
    state: { title: 'Initial' },
    usage: { tokens: 0 },
  });
  registry.registerGroup(api.conversation, key, instance);

  const controller = bindContract(api, {
    registry,
    impl: { conversation: fromRegistry() },
  });
  const pair = memoryTransportPair();
  serve(pair.right, controller);

  const client = contractClient(api, connect(pair.left));
  const conversation = client.conversation(key, {
    state: (state) => console.log('state:', state),
    usage: (usage) => console.log('usage:', usage),
  });

  await conversation.ready;
  const updated = await conversation.setTitle({ title: 'Grouped wire' });
  await updated.settled;
  await conversation.dispose();
}

void main();

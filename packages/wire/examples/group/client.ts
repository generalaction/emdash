import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  bindContract,
  client,
  connect,
  createLiveModelReplica,
  createLiveModelHost,
  defineContract,
  defineLiveModelContract,
  memoryTransportPair,
  mutation,
  serve,
} from '../../src/index';

const conversationKeySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ title: z.string() });
const usageSchema = z.object({ tokens: z.number() });

const api = defineContract({
  conversation: defineLiveModelContract({
    key: conversationKeySchema,
    models: {
      state: stateSchema,
      usage: usageSchema,
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
  const conversations = createLiveModelHost(api.conversation);
  conversations.create(key, {
    state: { title: 'Initial' },
    usage: { tokens: 0 },
  });

  const controller = bindContract(api, { conversation: conversations });
  const pair = memoryTransportPair();
  serve(pair.right, controller);

  const thin = client(api, connect(pair.left));
  const replica = createLiveModelReplica(api.conversation, thin.conversation, {
    onChange: {
      state: (state) => console.log('state:', state),
      usage: (usage) => console.log('usage:', usage),
    },
  });
  const lease = replica.acquire(key);
  const conversation = await lease.ready();

  const updated = await conversation.mutations.setTitle({ title: 'Grouped wire' });
  await updated.settled;
  await lease.release();
  await replica.dispose();
}

void main();

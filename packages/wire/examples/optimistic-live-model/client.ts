import { err, ok } from '@emdash/shared';
import { z } from 'zod';
import {
  bindContract,
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
import { OptimisticLiveModel } from '../../src/util/optimistic';

const conversationKeySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ title: z.string() });
const usageSchema = z.object({ tokens: z.number() });

const api = defineContract({
  conversation: liveModel({
    key: conversationKeySchema,
    states: {
      state: liveState({ data: stateSchema }),
      usage: liveState({ data: usageSchema }),
    },
    mutations: {
      setTitle: mutation(
        { input: z.object({ title: z.string() }), data: stateSchema, error: z.string() },
        (ctx, input) => {
          applyTitle(ctx, input.title);
          return ok({ title: input.title });
        }
      ),
      rejectTitle: mutation(
        { input: z.object({ title: z.string() }), data: stateSchema, error: z.string() },
        (ctx, input) => {
          if (isServerContext(ctx)) return err('server rejected title');
          applyTitle(ctx, input.title);
          return ok({ title: input.title });
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

  const pair = memoryTransportPair();
  const controller = bindContract(api, { conversation: conversations });
  serve(pair.right, controller);

  const contractClient = client(api, connect(pair.left));
  const replica = createLiveModelReplica(api.conversation, contractClient.conversation);
  const conversation = new OptimisticLiveModel(api.conversation, key, replica);
  await conversation.ready;

  console.log('initial:', conversation.values.state, conversation.values.usage);

  const setTitle = conversation.mutations.setTitle({ title: 'Optimistic wire' });
  console.log('optimistic:', conversation.values.state, conversation.values.usage);
  const setTitleResult = await setTitle;
  await setTitleResult.settled;
  console.log('confirmed:', conversation.values.state, conversation.values.usage);

  const rejected = conversation.mutations.rejectTitle({ title: 'Rollback' });
  console.log('before rollback:', conversation.values.state, conversation.values.usage);
  const rejectedResult = await rejected;
  console.log('rejected result:', rejectedResult.result);
  console.log('after rollback:', conversation.values.state, conversation.values.usage);

  await conversation.dispose();
  await replica.dispose();
}

function applyTitle(
  ctx: { produce(name: 'state' | 'usage', mutator: (draft: unknown) => void): void },
  title: string
): void {
  ctx.produce('state', (draft) => {
    (draft as { title: string }).title = title;
  });
  ctx.produce('usage', (draft) => {
    (draft as { tokens: number }).tokens += title.length;
  });
}

function isServerContext(ctx: unknown): boolean {
  return typeof (ctx as { cursors?: unknown }).cursors === 'function';
}

void main();

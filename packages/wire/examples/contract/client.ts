import { ok } from '@emdash/shared';
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

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ messages: z.array(z.string()) });

type ChatState = z.infer<typeof stateSchema>;

const chatContract = defineContract({
  conversation: liveModel({
    key: keySchema,
    states: {
      state: liveState({ data: stateSchema }),
    },
    mutations: {
      send: mutation(
        {
          input: z.object({ text: z.string() }),
          data: stateSchema,
          error: z.string(),
        },
        (ctx, input) => {
          let messages: string[] = [];
          ctx.produce('state', (draft) => {
            const state = draft as ChatState;
            state.messages.push(input.text);
            messages = [...state.messages];
          });
          return ok({ messages });
        }
      ),
    },
  }),
});

const key = { conversationId: 'demo' };
const conversations = createLiveModelHost(chatContract.conversation);
conversations.create(key, {
  state: { messages: [] } satisfies ChatState,
});

const controller = bindContract(chatContract, {
  conversation: conversations,
});

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  serve(pair.right, controller);
  const contractClient = client(chatContract, connect(pair.left));

  const replica = createLiveModelReplica(chatContract.conversation, contractClient.conversation, {
    onChange: {
      state: (value) => {
        console.log('state:', value);
      },
    },
  });
  const lease = replica.acquire(key);
  const conversation = await lease.ready();

  const sent = await conversation.mutations.send({ text: 'hello wire' });
  await sent.settled;
  await lease.release();
  await replica.dispose();
}

void main();

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

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ messages: z.array(z.string()) });

type ChatState = z.infer<typeof stateSchema>;

const chatContract = defineContract({
  conversation: defineLiveModelContract({
    key: keySchema,
    models: {
      state: stateSchema,
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
  const client = contractClient(chatContract, connect(pair.left));

  const conversation = client.conversation(key, {
    state: (value) => {
      console.log('state:', value);
    },
  });

  await conversation.ready;
  const sent = await conversation.send({ text: 'hello wire' });
  await sent.settled;
  await conversation.dispose();
}

void main();

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

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ messages: z.array(z.string()) });

type ChatState = z.infer<typeof stateSchema>;

const chatContract = defineContract({
  conversation: liveModelGroup({
    key: keySchema,
    models: {
      state: liveModel({ data: stateSchema }),
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
const registry = new LiveModelRegistry();
const instance = createGroupInstance(chatContract.conversation, key, {
  state: { messages: [] } satisfies ChatState,
});
registry.registerGroup(chatContract.conversation, key, instance);

const controller = bindContract(chatContract, {
  registry,
  impl: {
    conversation: fromRegistry(),
  },
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

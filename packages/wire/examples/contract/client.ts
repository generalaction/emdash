import { z } from 'zod';
import {
  bind,
  connect,
  contractClient,
  defineContract,
  liveLogRef,
  liveModelRef,
  LiveLogServer,
  LiveModelServer,
  memoryTransportPair,
  procedure,
  serve,
} from '../../src/index';

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ messages: z.array(z.string()) });

const chatContract = defineContract({
  procedures: {
    send: procedure({ input: keySchema.extend({ text: z.string() }), output: stateSchema }),
  },
  models: {
    state: liveModelRef('example.chat.state', keySchema, stateSchema),
  },
  logs: {
    output: liveLogRef('example.chat.output', keySchema),
  },
});

type ChatState = z.infer<typeof stateSchema>;

const state = new LiveModelServer<ChatState>({ messages: [] }, 1000);
const output = new LiveLogServer({ generation: 2000 });

const controller = bind(chatContract, {
  procedures: {
    send: ({ text }) => {
      state.produce((draft) => {
        draft.messages.push(text);
      });
      output.append(`sent: ${text}\n`);
      return state.snapshot().data;
    },
  },
  live: {
    models: { state: () => state },
    logs: { output: () => output },
  },
});

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  serve(pair.right, controller);
  const client = contractClient(chatContract, connect(pair.left));

  const model = client.model('state', { conversationId: 'demo' }, (value) => {
    console.log('state:', value);
  });
  const log = client.log(
    'output',
    { conversationId: 'demo' },
    {
      onReset: (data) => console.log('log reset:', data.text),
      onAppend: (chunk) => console.log('log append:', chunk.trim()),
    }
  );

  await model.ready;
  await log.ready;
  await client.send({ conversationId: 'demo', text: 'hello wire' });
  await Promise.resolve();
  await model.dispose();
  await log.dispose();
}

void main();

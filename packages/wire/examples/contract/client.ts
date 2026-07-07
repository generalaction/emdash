import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  LiveLogServer,
  LiveModelRegistry,
  LiveModelServer,
  bindContract,
  connect,
  contractClient,
  defineContract,
  fromRegistry,
  liveLog,
  liveModel,
  memoryTransportPair,
  mutation,
  serve,
} from '../../src/index';

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ messages: z.array(z.string()) });

type ChatState = z.infer<typeof stateSchema>;

const chatContract = defineContract({
  state: liveModel({ key: keySchema, data: stateSchema }),
  output: liveLog({ key: keySchema }),
  send: mutation({
    input: keySchema.extend({ text: z.string() }),
    data: stateSchema,
    error: z.string(),
  }),
});

const key = { conversationId: 'demo' };
const registry = new LiveModelRegistry();
const state = new LiveModelServer<ChatState>({ messages: [] }, 1000);
const output = new LiveLogServer({ generation: 2000 });
registry.register(chatContract.state, key, state);

const controller = bindContract(chatContract, {
  registry,
  impl: {
    state: fromRegistry(),
    output: () => output,
    send: (ctx, input) => {
      ctx.produce(chatContract.state, { conversationId: input.conversationId }, (draft) => {
        draft.messages.push(input.text);
      });
      output.append(`sent: ${input.text}\n`);
      return ok(state.snapshot().data);
    },
  },
});

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  serve(pair.right, controller);
  const client = contractClient(chatContract, connect(pair.left));

  const model = client.state(key, (value) => {
    console.log('state:', value);
  });
  const log = client.output(key, {
    onReset: (data) => console.log('log reset:', data.text),
    onAppend: (chunk) => console.log('log append:', chunk.trim()),
  });

  await model.ready;
  await log.ready;
  const sent = await client.send({ ...key, text: 'hello wire' });
  await sent.settled;
  await model.dispose();
  await log.dispose();
}

void main();

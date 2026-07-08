import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  bindContract,
  client,
  connect,
  createLiveModelHost,
  createLiveModelReplica,
  defineContract,
  defineLiveModelContract,
  materializeInstance,
  memoryTransportPair,
  mutation,
  serve,
} from '../../src/index';

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ title: z.string() });

const api = defineContract({
  conversation: defineLiveModelContract({
    key: keySchema,
    models: {
      state: stateSchema,
    },
    mutations: {
      setTitle: mutation(
        { input: z.object({ title: z.string() }), data: stateSchema, error: z.string() },
        (ctx, input) => {
          ctx.produce('state', (draft) => {
            (draft as { title: string }).title = input.title;
          });
          return ok({ title: input.title });
        }
      ),
    },
  }),
});

async function main(): Promise<void> {
  const key = { conversationId: 'demo' };

  const host = createLiveModelHost(api.conversation);
  host.create(key, { state: { title: 'Initial' } });
  const workspacePair = memoryTransportPair();
  serve(workspacePair.right, bindContract(api, { conversation: host }));

  const upstream = client(api, connect(workspacePair.left));
  const replica = createLiveModelReplica(api.conversation, upstream.conversation, {
    retentionMs: 10_000,
  });
  const desktopPair = memoryTransportPair();
  serve(desktopPair.right, bindContract(api, { conversation: replica }));

  const renderer = client(api, connect(desktopPair.left));
  const firstWindow = materializeInstance(renderer.conversation, key, {
    onChange: {
      state: (state) => console.log('window state:', state),
    },
  });
  await firstWindow.ready;
  const updated = await firstWindow.mutations.setTitle({ title: 'Cached in Electron main' });
  await updated.settled;
  await firstWindow.dispose();

  const reloadedWindow = materializeInstance(renderer.conversation, key);
  await reloadedWindow.ready;
  console.log('reloaded snapshot:', reloadedWindow.models.state.current());
  await reloadedWindow.dispose();
  await replica.dispose();
}

void main();

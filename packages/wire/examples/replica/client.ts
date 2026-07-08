import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  bindContract,
  client,
  connect,
  createLiveModelHost,
  createLiveModelReplica,
  defineContract,
  liveModel,
  liveState,
  memoryTransportPair,
  mutation,
  serve,
} from '../../src/index';

const keySchema = z.object({ conversationId: z.string() });
const stateSchema = z.object({ title: z.string() });

const api = defineContract({
  conversation: liveModel({
    key: keySchema,
    states: {
      state: liveState({ data: stateSchema }),
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
  const firstReplica = createLiveModelReplica(api.conversation, renderer.conversation, {
    onChange: {
      state: (state) => console.log('window state:', state),
    },
  });
  const firstLease = firstReplica.acquire(key);
  const firstWindow = await firstLease.ready();
  const updated = await firstWindow.mutations.setTitle({ title: 'Cached in Electron main' });
  await updated.settled;
  await firstLease.release();
  await firstReplica.dispose();

  const reloadedReplica = createLiveModelReplica(api.conversation, renderer.conversation);
  const reloadedLease = reloadedReplica.acquire(key);
  const reloadedWindow = await reloadedLease.ready();
  console.log('reloaded snapshot:', reloadedWindow.states.state.current());
  await reloadedLease.release();
  await reloadedReplica.dispose();
  await replica.dispose();
}

void main();

import {
  client,
  connect,
  createLiveModelReplica,
  memoryTransportPair,
  serve,
} from '../../src/index';
import { notesController } from '../api-binding/controller';
import { notesApi } from '../api-definition/contract';

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  serve(pair.right, notesController);

  const thin = client(notesApi, connect(pair.left));
  const session = { sessionId: 'demo' };

  const sessions = createLiveModelReplica(notesApi.session, thin.session, {
    onChange: {
      notes: (state) => {
        console.log('notes model:', state);
      },
    },
  });
  const sessionLease = sessions.acquire(session);
  const sessionBinding = await sessionLease.ready();
  const activity = thin.activity.handle(session);

  console.log('activity reset:', JSON.stringify((await activity.snapshot()).data));
  const detachActivity = await activity.attach((update) => {
    const delta = update.delta as { chunk: string };
    console.log('activity append:', delta.chunk.trim());
  });
  const added = await sessionBinding.mutations.addNote({ text: 'Typed client mutation' });
  await added.settled;
  await thin.clearNotes(session);
  await Promise.resolve();

  await sessionLease.release();
  await sessions.dispose();
  detachActivity();
}

void main();

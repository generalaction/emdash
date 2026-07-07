import { connect, contractClient, memoryTransportPair, serve } from '../../src/index';
import { notesController } from '../api-binding/controller';
import { notesApi } from '../api-definition/contract';

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  serve(pair.right, notesController);

  const client = contractClient(notesApi, connect(pair.left));
  const session = { sessionId: 'demo' };

  const notesBinding = client.notes(session, (state) => {
    console.log('notes model:', state);
  });
  const activityBinding = client.activity(session, {
    onReset: (snapshot) => console.log('activity reset:', JSON.stringify(snapshot)),
    onAppend: (chunk) => console.log('activity append:', chunk.trim()),
  });

  await notesBinding.ready;
  await activityBinding.ready;
  const added = await client.addNote({ ...session, text: 'Typed client mutation' });
  await added.settled;
  await client.clearNotes(session);
  await Promise.resolve();

  await notesBinding.dispose();
  await activityBinding.dispose();
}

void main();

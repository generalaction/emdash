import { connect, contractClient, memoryTransportPair, serve } from '../../src/index';
import { notesController } from '../api-binding/controller';
import { notesApi } from '../api-definition/contract';

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  serve(pair.right, notesController);

  const client = contractClient(notesApi, connect(pair.left));
  const session = { sessionId: 'demo' };

  const sessionBinding = client.session(session, {
    notes: (state) => {
      console.log('notes model:', state);
    },
  });
  const activityBinding = client.activity(session, {
    onReset: (snapshot) => console.log('activity reset:', JSON.stringify(snapshot)),
    onAppend: (chunk) => console.log('activity append:', chunk.trim()),
  });

  await sessionBinding.ready;
  await activityBinding.ready;
  const added = await sessionBinding.addNote({ text: 'Typed client mutation' });
  await added.settled;
  await client.clearNotes(session);
  await Promise.resolve();

  await sessionBinding.dispose();
  await activityBinding.dispose();
}

void main();

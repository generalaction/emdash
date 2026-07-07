import { connect, contractClient, memoryTransportPair, serve } from '../../src/index';
import { notesController } from '../api-binding/controller';
import { notesApi } from '../api-definition/contract';

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  serve(pair.right, notesController);

  const connection = connect(pair.left);
  const client = contractClient(notesApi, connection);
  const session = { sessionId: 'demo' };

  const notesBinding = client.model('notes', session, (state) => {
    console.log('notes model:', state);
  });
  const activityBinding = client.log('activity', session, {
    onReset: (snapshot) => console.log('activity reset:', JSON.stringify(snapshot)),
    onAppend: (chunk) => console.log('activity append:', chunk.trim()),
  });

  await notesBinding.ready;
  await activityBinding.ready;
  await client.addNote({ ...session, text: 'Typed client call' });
  await client.clearNotes(session);
  await Promise.resolve();

  await notesBinding.dispose();
  await activityBinding.dispose();
}

void main();

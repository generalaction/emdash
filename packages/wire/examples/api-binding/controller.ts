import {
  LiveLogServer,
  LiveModelRegistry,
  bindContract,
  createGroupInstance,
  encodeTopic,
  fromRegistry,
} from '../../src/index';
import { notesApi, type NotesState } from '../api-definition/contract';

const session = { sessionId: 'demo' };
const registry = new LiveModelRegistry();
const instance = createGroupInstance(notesApi.session, session, {
  notes: { notes: [] } satisfies NotesState,
});
const activity = new LiveLogServer({ generation: 2000 });

registry.registerGroup(notesApi.session, session, instance);

export const notesController = bindContract(notesApi, {
  registry,
  impl: {
    session: fromRegistry(),
    activity: () => activity,
    clearNotes: () => {
      instance.models.notes.produce((draft) => {
        draft.notes = [];
      });
      activity.append('cleared notes\n');
      return instance.models.notes.snapshot().data;
    },
  },
});

async function main(): Promise<void> {
  const note = await notesController.call('session.addNote', {
    key: session,
    input: { text: 'Bound controller call' },
  });
  const topic = encodeTopic(notesApi.session.models.notes.id, session);
  const snapshot = await notesController.resolveLive(topic)?.snapshot();

  console.log('mutation result:', note);
  console.log('model snapshot:', snapshot?.data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

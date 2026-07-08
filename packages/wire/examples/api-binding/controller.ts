import { LiveLog, bindContract, createLiveModelHost, encodeTopic } from '../../src/index';
import { notesApi, type NotesState } from '../api-definition/contract';

const session = { sessionId: 'demo' };
const sessions = createLiveModelHost(notesApi.session);
const instance = sessions.create(session, {
  notes: { notes: [] } satisfies NotesState,
});
const activity = new LiveLog({ generation: 2000 });

export const notesController = bindContract(notesApi, {
  session: sessions,
  activity: () => activity,
  clearNotes: () => {
    instance.states.notes.produce((draft) => {
      draft.notes = [];
    });
    activity.append('cleared notes\n');
    return instance.states.notes.snapshot().data;
  },
});

async function main(): Promise<void> {
  const note = await notesController.call('session.addNote', {
    key: session,
    input: { text: 'Bound controller call' },
  });
  const topic = encodeTopic(notesApi.session.states.notes.id, session);
  const snapshot = await notesController.resolveLive(topic)?.snapshot();

  console.log('mutation result:', note);
  console.log('model snapshot:', snapshot?.data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

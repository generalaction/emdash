import { LiveLogServer, LiveModelServer, bind, encodeTopic } from '../../src/index';
import { notesApi, type NotesState } from '../api-definition/contract';

const notes = new LiveModelServer<NotesState>({ notes: [] }, 1000);
const activity = new LiveLogServer({ generation: 2000 });

export const notesController = bind(notesApi, {
  procedures: {
    addNote: ({ text }) => {
      const note = { id: `note-${notes.snapshot().data.notes.length + 1}`, text };
      notes.produce((draft) => {
        draft.notes.push(note);
      });
      activity.append(`added ${note.id}\n`);
      return note;
    },
    clearNotes: () => {
      notes.produce((draft) => {
        draft.notes = [];
      });
      activity.append('cleared notes\n');
      return notes.snapshot().data;
    },
  },
  live: {
    models: {
      notes: () => notes,
    },
    logs: {
      activity: () => activity,
    },
  },
});

async function main(): Promise<void> {
  const session = { sessionId: 'demo' };
  const note = await notesController.call('addNote', { ...session, text: 'Bound controller call' });
  const topic = encodeTopic(notesApi.models.notes.id, session);
  const snapshot = notesController.resolveLive(topic)?.snapshot();

  console.log('procedure result:', note);
  console.log('model snapshot:', snapshot?.data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

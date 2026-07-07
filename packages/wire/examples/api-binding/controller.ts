import { ok } from '@emdash/shared';
import {
  LiveLogServer,
  LiveModelRegistry,
  LiveModelServer,
  bindContract,
  encodeTopic,
  fromRegistry,
} from '../../src/index';
import { notesApi, type NotesState } from '../api-definition/contract';

const session = { sessionId: 'demo' };
const registry = new LiveModelRegistry();
const notes = new LiveModelServer<NotesState>({ notes: [] }, 1000);
const activity = new LiveLogServer({ generation: 2000 });

registry.register(notesApi.notes, session, notes);

export const notesController = bindContract(notesApi, {
  registry,
  impl: {
    notes: fromRegistry(),
    activity: () => activity,
    addNote: (ctx, input) => {
      const note = { id: `note-${notes.snapshot().data.notes.length + 1}`, text: input.text };
      ctx.produce(notesApi.notes, { sessionId: input.sessionId }, (draft) => {
        draft.notes.push(note);
      });
      activity.append(`added ${note.id}\n`);
      return ok(note);
    },
    clearNotes: () => {
      notes.produce((draft) => {
        draft.notes = [];
      });
      activity.append('cleared notes\n');
      return notes.snapshot().data;
    },
  },
});

async function main(): Promise<void> {
  const note = await notesController.call('addNote', {
    ...session,
    text: 'Bound controller call',
  });
  const topic = encodeTopic(notesApi.notes.id, session);
  const snapshot = await notesController.resolveLive(topic)?.snapshot();

  console.log('mutation result:', note);
  console.log('model snapshot:', snapshot?.data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

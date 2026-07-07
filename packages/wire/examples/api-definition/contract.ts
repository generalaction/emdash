import { z } from 'zod';
import { defineContract, liveLogRef, liveModelRef, procedure } from '../../src/index';

export const sessionKeySchema = z.object({ sessionId: z.string() });
export const noteSchema = z.object({ id: z.string(), text: z.string() });
export const notesStateSchema = z.object({ notes: z.array(noteSchema) });

export type SessionKey = z.infer<typeof sessionKeySchema>;
export type NotesState = z.infer<typeof notesStateSchema>;

export const notesApi = defineContract({
  procedures: {
    addNote: procedure({
      input: sessionKeySchema.extend({ text: z.string() }),
      output: noteSchema,
    }),
    clearNotes: procedure({
      input: sessionKeySchema,
      output: notesStateSchema,
    }),
  },
  models: {
    notes: liveModelRef('examples.notes.state', sessionKeySchema, notesStateSchema),
  },
  logs: {
    activity: liveLogRef('examples.notes.activity', sessionKeySchema),
  },
});

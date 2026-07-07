import { z } from 'zod';
import { defineContract, liveLog, liveModel, mutation, procedure } from '../../src/index';

export const sessionKeySchema = z.object({ sessionId: z.string() });
export const noteSchema = z.object({ id: z.string(), text: z.string() });
export const notesStateSchema = z.object({ notes: z.array(noteSchema) });

export type SessionKey = z.infer<typeof sessionKeySchema>;
export type NotesState = z.infer<typeof notesStateSchema>;

export const notesApi = defineContract({
  notes: liveModel({ key: sessionKeySchema, data: notesStateSchema }),
  activity: liveLog({ key: sessionKeySchema }),
  addNote: mutation({
    input: sessionKeySchema.extend({ text: z.string() }),
    data: noteSchema,
    error: z.string(),
  }),
  clearNotes: procedure({
    input: sessionKeySchema,
    output: notesStateSchema,
  }),
});

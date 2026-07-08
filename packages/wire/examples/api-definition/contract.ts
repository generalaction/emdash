import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  defineContract,
  defineLiveModelContract,
  liveLog,
  liveModel,
  mutation,
  procedure,
} from '../../src/index';

export const sessionKeySchema = z.object({ sessionId: z.string() });
export const noteSchema = z.object({ id: z.string(), text: z.string() });
export const notesStateSchema = z.object({ notes: z.array(noteSchema) });

export type SessionKey = z.infer<typeof sessionKeySchema>;
export type NotesState = z.infer<typeof notesStateSchema>;

export const notesApi = defineContract({
  notes: liveModel({ key: sessionKeySchema, data: notesStateSchema }),
  activity: liveLog({ key: sessionKeySchema }),
  session: defineLiveModelContract({
    key: sessionKeySchema,
    models: {
      notes: notesStateSchema,
    },
    mutations: {
      addNote: mutation(
        {
          input: z.object({ text: z.string() }),
          data: noteSchema,
          error: z.string(),
        },
        (ctx, input) => {
          const note = { id: input.text.toLowerCase().replace(/\s+/g, '-'), text: input.text };
          ctx.produce('notes', (draft) => {
            (draft as NotesState).notes.push(note);
          });
          return ok(note);
        }
      ),
    },
  }),
  clearNotes: procedure({
    input: sessionKeySchema,
    output: notesStateSchema,
  }),
});

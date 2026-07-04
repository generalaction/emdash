import { z } from 'zod';
import { terminalExitSchema } from '../models/terminals';

export const terminalOutputEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chunk'),
    chunk: z.string(),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal('finished'),
    exitStatus: terminalExitSchema,
  }),
]);
export type TerminalOutputEvent = z.infer<typeof terminalOutputEventSchema>;

export const terminalOutputInputSchema = z.object({
  terminalId: z.string(),
  offset: z.number().int().optional(),
});

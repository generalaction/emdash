import { z } from 'zod';

/**
 * Identifies one keystroke batch from one client. Writers number their input per target; a
 * resend after a reconnect is marked `replay`, so the host can tell a retry from new input.
 */
export const inputSequenceSchema = z.object({
  writer: z.string().min(1),
  seq: z.number().int().nonnegative(),
  replay: z.boolean().optional(),
});

export type InputSequence = z.infer<typeof inputSequenceSchema>;

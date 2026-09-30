import { z } from 'zod';

export const stopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
]);
export type StopReason = z.infer<typeof stopReasonSchema>;

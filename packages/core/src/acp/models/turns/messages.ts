import { z } from 'zod';
import { attachmentRefSchema } from '../attachments';

export const transcriptMessageSchema = z.object({
  kind: z.literal('message'),
  /** Provider message id scoped to the turn, or reducer-synthesized fallback id. */
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  /** True while later chunks may append to this message within the active turn. */
  streaming: z.boolean(),
  /** Attachment metadata only; bytes are served separately by the runtime. */
  attachments: z.array(attachmentRefSchema).optional(),
});
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;

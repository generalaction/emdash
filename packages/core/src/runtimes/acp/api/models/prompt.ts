import { z } from 'zod';
import { promptAttachmentSchema } from './attachments';
export type { PromptAttachment } from './attachments';

export const promptInputSchema = z.object({
  text: z.string(),
  hiddenContext: z.string().optional(),
  attachments: z.array(promptAttachmentSchema).optional(),
});
export type PromptInput = z.infer<typeof promptInputSchema>;

export const queuedPromptSchema = promptInputSchema.extend({
  /** Runtime-generated id used for queue removal and stable UI keys. */
  id: z.string(),
  /** Epoch ms when this prompt entered the runtime queue/model. */
  createdAt: z.number(),
  /** Epoch ms when queued prompt content or attachments were last edited. */
  updatedAt: z.number(),
});
export type QueuedPrompt = z.infer<typeof queuedPromptSchema>;

// Providers replay every prompt block as user text on session/load, so hidden context is sent as
// its own marked block and transcript decoding drops chunks that are exactly one such block.
// Matching the whole chunk (not a pattern inside it) means marker text inside the context, or in
// what the user typed, can neither end the block early nor erase visible text.
const HIDDEN_CONTEXT_OPEN = '<emdash-hidden-context>\n';
const HIDDEN_CONTEXT_CLOSE = '\n</emdash-hidden-context>';

export function wrapHiddenContext(text: string): string {
  return `${HIDDEN_CONTEXT_OPEN}${text}${HIDDEN_CONTEXT_CLOSE}`;
}

export function isHiddenContextBlock(text: string): boolean {
  return text.startsWith(HIDDEN_CONTEXT_OPEN) && text.endsWith(HIDDEN_CONTEXT_CLOSE);
}

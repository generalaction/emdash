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

// Providers replay every prompt block as user text on session/load, so hidden context is sent
// inside a marker that transcript decoding strips back out.
const HIDDEN_CONTEXT_PATTERN = /<emdash-hidden-context>[\s\S]*?<\/emdash-hidden-context>/g;

export function wrapHiddenContext(text: string): string {
  return `<emdash-hidden-context>\n${text}\n</emdash-hidden-context>`;
}

export function stripHiddenContext(text: string): string {
  return text.replace(HIDDEN_CONTEXT_PATTERN, '');
}

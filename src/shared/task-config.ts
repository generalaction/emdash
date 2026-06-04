import z from 'zod';
import { conversationConfigSchema } from './automations/config';

export const taskConfigSchema = z.object({
  version: z.literal('1'),
  name: z.string(),
  linkedIssue: z
    .object({
      id: z.string(),
      number: z.number(),
    })
    .optional(),
  initialConversation: conversationConfigSchema.optional(),
  initialStatus: z.enum(['in_progress', 'completed', 'failed']).optional(),
});

export type TaskConfig = z.infer<typeof taskConfigSchema>;

import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';

const DROID_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDroidProviderSessionId(value: string): boolean {
  return DROID_SESSION_ID_PATTERN.test(value);
}

const conversationConfigV0Schema = z.object({
  autoApprove: z.boolean().optional(),
  /** Initial prompt to deliver on the first spawn; cleared from config after the session starts. */
  initialPrompt: z.string().optional(),
  /** Selected model id for ACP-based chat conversations. */
  model: z.string().optional(),
});

export const conversationConfig = defineVersionedSchema()
  .unversioned(conversationConfigV0Schema)
  .build();

export type ConversationConfig = typeof conversationConfig.Type;

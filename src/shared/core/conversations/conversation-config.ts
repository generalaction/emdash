import z from 'zod';
import { defineVersionedSchema } from '@shared/lib/versioned-schema/versioned-schema';
import {
  CODEX_SERVICE_TIERS,
  isValidNativeChatModelId,
  NATIVE_CHAT_REASONING_EFFORTS,
} from '@shared/native-chat';

const DROID_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDroidProviderSessionId(value: string): boolean {
  return DROID_SESSION_ID_PATTERN.test(value);
}

const conversationConfigV0Schema = z.object({
  autoApprove: z.boolean().optional(),
  /** Provider-native session id (e.g. Droid UUID) for resuming the correct chat. */
  providerSessionId: z.string().optional(),
  /** Initial prompt to deliver on the first spawn; cleared from config after the session starts. */
  initialPrompt: z.string().optional(),
  /** Only 'native-chat' is persisted; absent means the default terminal UI. */
  uiMode: z.literal('native-chat').optional(),
  /** Native chat: reasoning effort override; absent means model default. */
  reasoningEffort: z.enum(NATIVE_CHAT_REASONING_EFFORTS).optional(),
  /** Native chat: model override; absent means the provider's default. */
  model: z.string().refine(isValidNativeChatModelId).optional(),
  /** Codex native chat: speed (service tier) override; absent means standard. */
  serviceTier: z.enum(CODEX_SERVICE_TIERS).optional(),
});

export const conversationConfig = defineVersionedSchema()
  .unversioned(conversationConfigV0Schema)
  .build();

export type ConversationConfig = typeof conversationConfig.Type;

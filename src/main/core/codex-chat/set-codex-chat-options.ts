import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { parseConversationConfig, serializeConversationConfig } from '@shared/conversation-config';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import {
  isCodexServiceTier,
  isNativeChatReasoningEffort,
  isValidNativeChatModelId,
  type CodexChatOptions,
} from '@shared/native-chat';

/**
 * Persist per-conversation Codex options (model, reasoning effort) used by
 * native chat turns. A null field clears back to the default; an absent field
 * is left untouched.
 */
export async function setCodexChatOptions(
  projectId: string,
  taskId: string,
  conversationId: string,
  options: CodexChatOptions
): Promise<void> {
  if (options.model != null && !isValidNativeChatModelId(options.model)) {
    throw new Error(`Invalid model id: ${String(options.model)}`);
  }
  if (options.reasoningEffort != null && !isNativeChatReasoningEffort(options.reasoningEffort)) {
    throw new Error(`Invalid reasoning effort: ${String(options.reasoningEffort)}`);
  }
  if (options.serviceTier != null && !isCodexServiceTier(options.serviceTier)) {
    throw new Error(`Invalid service tier: ${String(options.serviceTier)}`);
  }

  const [row] = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);
  if (!row) throw new Error('Conversation not found');

  const config = parseConversationConfig(row.config);

  if (options.model !== undefined) {
    if (options.model === null) delete config.model;
    else config.model = options.model;
  }
  if (options.reasoningEffort !== undefined) {
    if (options.reasoningEffort === null) delete config.reasoningEffort;
    else config.reasoningEffort = options.reasoningEffort;
  }
  if (options.serviceTier !== undefined) {
    if (options.serviceTier === null) delete config.serviceTier;
    else config.serviceTier = options.serviceTier;
  }
  if (options.autoApprove !== undefined) {
    config.autoApprove = options.autoApprove;
  }

  await db
    .update(conversations)
    .set({ config: serializeConversationConfig(config) })
    .where(eq(conversations.id, conversationId));

  events.emit(conversationChangedChannel, {
    conversationId,
    taskId,
    projectId,
    changes: {
      ...(options.model !== undefined ? { model: config.model } : {}),
      ...(options.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {}),
      ...(options.serviceTier !== undefined ? { serviceTier: config.serviceTier } : {}),
      ...(options.autoApprove !== undefined ? { autoApprove: config.autoApprove } : {}),
    },
  });
}

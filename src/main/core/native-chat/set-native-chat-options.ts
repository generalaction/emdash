import { and, eq } from 'drizzle-orm';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { parseConversationConfig, serializeConversationConfig } from '@shared/conversation-config';
import { isNativeChatProvider } from '@shared/conversation-ui';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import {
  isCodexServiceTier,
  isNativeChatReasoningEffort,
  isValidNativeChatModelId,
  type NativeChatOptions,
} from '@shared/native-chat';

/**
 * Persist per-conversation options (model, reasoning effort) used by
 * native chat turns. A null field clears back to the default; an absent field
 * is left untouched. Model/reasoning/speed changes also become the provider's
 * defaults for new native-chat conversations.
 */
export async function setNativeChatOptions(
  projectId: string,
  taskId: string,
  conversationId: string,
  options: NativeChatOptions
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
    .select({ config: conversations.config, provider: conversations.provider })
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

  // Remember the trio as this provider's defaults for future conversations.
  const touchesDefaults =
    options.model !== undefined ||
    options.reasoningEffort !== undefined ||
    options.serviceTier !== undefined;
  if (touchesDefaults && row.provider && isNativeChatProvider(row.provider)) {
    try {
      const defaults = await appSettingsService.get('nativeChatDefaults');
      await appSettingsService.update('nativeChatDefaults', {
        ...defaults,
        [row.provider]: {
          ...(config.model ? { model: config.model } : {}),
          ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
          ...(config.serviceTier ? { serviceTier: config.serviceTier } : {}),
        },
      });
    } catch (error) {
      log.warn('native-chat: failed to persist provider option defaults', {
        provider: row.provider,
        error: String(error),
      });
    }
  }

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

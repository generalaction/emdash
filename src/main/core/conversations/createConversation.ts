import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { appSettingsService } from '@main/core/settings/settings-service';
import { withCompensation } from '@main/core/utils/compensation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { serializeConversationConfig } from '@shared/conversation-config';
import {
  type Conversation,
  type ConversationRuntimeMode,
  type CreateConversationParams,
  resolveConversationRuntimeMode,
  shouldUseChatRuntime,
} from '@shared/conversations';
import { resolveTask } from '../projects/utils';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';
import { conversationEvents } from './conversation-events';
import { mapConversationRowToConversation } from './utils';

async function resolveRuntimeMode(
  provider: CreateConversationParams['provider']
): Promise<ConversationRuntimeMode> {
  const interfaceSettings = await appSettingsService.get('interface');
  return resolveConversationRuntimeMode({
    providerId: provider,
    requestedMode: interfaceSettings.conversationUiMode,
  });
}

export async function createConversation(params: CreateConversationParams): Promise<Conversation> {
  const id = params.id ?? randomUUID();
  const runtimeMode = await resolveRuntimeMode(params.provider);
  const [existingConversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, params.taskId))
    .limit(1);

  const config = serializeConversationConfig({
    ...(params.autoApprove === undefined ? {} : { autoApprove: params.autoApprove }),
    ...(runtimeMode === 'chat' && params.initialPrompt?.trim()
      ? { initialPrompt: params.initialPrompt }
      : {}),
  });

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const [row] = await db
    .insert(conversations)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title,
      provider: params.provider,
      config: config === '{}' ? undefined : config,
      isInitialConversation: params.isInitialConversation ?? false,
      runtimeMode,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: new Date().toISOString(),
    })
    .returning();

  const conversation = mapConversationRowToConversation(row);

  await withCompensation({
    action: async () => {
      if (shouldUseChatRuntime(conversation)) {
        await chatConversationRuntime.startConversation(conversation);
        return;
      }
      await task.conversations.startSession(
        conversation,
        params.initialSize,
        false,
        params.initialPrompt
      );
    },
    compensate: async () => {
      await db.delete(conversations).where(eq(conversations.id, row.id)).execute();
    },
    onCompensationError: (error) => {
      log.error('createConversation: failed to roll back conversation row after spawn failure', {
        conversationId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  conversationEvents._emit('conversation:created', conversation);
  telemetryService.capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return conversation;
}

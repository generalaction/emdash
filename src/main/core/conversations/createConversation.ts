import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { withCompensation } from '@main/core/utils/compensation';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';
import { mapConversationRowToConversation } from './utils';

type ConversationCreateDb = Pick<typeof db, 'delete' | 'insert' | 'select'>;

export async function createConversation(
  params: CreateConversationParams,
  database: ConversationCreateDb = db
): Promise<Conversation> {
  const id = params.id ?? randomUUID();
  const [existingConversation] = await database
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, params.taskId))
    .limit(1);

  const config =
    params.autoApprove === undefined
      ? undefined
      : JSON.stringify({ autoApprove: params.autoApprove });

  const [row] = await database
    .insert(conversations)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title,
      provider: params.provider,
      config,
      isInitialConversation: params.isInitialConversation ?? false,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: new Date().toISOString(),
    })
    .returning();

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const conversation = mapConversationRowToConversation(row);

  await withCompensation({
    action: () =>
      task.conversations.startSession(
        conversation,
        params.initialSize,
        false,
        params.initialPrompt
      ),
    compensate: async () => {
      await database.delete(conversations).where(eq(conversations.id, row.id)).execute();
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

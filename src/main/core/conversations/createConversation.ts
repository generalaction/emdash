import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { capture } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { mapConversationRowToConversation } from './utils';

export async function createConversation(params: CreateConversationParams): Promise<Conversation> {
  const id = params.id ?? randomUUID();
  const [existingConversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, params.taskId))
    .limit(1);

  const config =
    params.autoApprove === undefined
      ? undefined
      : JSON.stringify({ autoApprove: params.autoApprove });

  const [row] = await db
    .insert(conversations)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title,
      provider: params.provider,
      config,
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const conversation = mapConversationRowToConversation(row);

  await task.conversations.startSession(
    conversation,
    params.initialSize,
    false,
    params.initialPrompt
  );
  capture('conversation_created', {
    provider: params.provider,
    is_first_in_task: existingConversation === undefined,
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: id,
  });

  return mapConversationRowToConversation(row);
}

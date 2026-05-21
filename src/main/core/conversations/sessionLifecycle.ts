import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { mapConversationRowToConversation } from './utils';

export async function startConversationSession(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);

  if (!row) return;

  const task = resolveTask(projectId, taskId);
  await task?.conversations.startSession(
    mapConversationRowToConversation(row, true),
    undefined,
    true
  );
}

export async function stopConversationSession(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const task = resolveTask(projectId, taskId);
  await task?.conversations.stopSession(conversationId);
}

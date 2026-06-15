import { and, eq } from 'drizzle-orm';
import { acpSessionManager } from '@main/core/acp/acp-session-manager';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { mapConversationRowToConversation } from './utils';

export async function dehydrateConversation(
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

  if (row) {
    const conversation = mapConversationRowToConversation(row);
    if (conversation.type === 'acp') {
      acpSessionManager.stop(conversationId);
      return;
    }
  }

  const task = resolveTask(projectId, taskId);
  await task?.conversations.detachSession(conversationId);
}

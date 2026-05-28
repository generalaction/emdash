import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { shouldUseChatRuntime } from '@shared/conversations';
import { resolveTask } from '../projects/utils';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';
import { mapConversationRowToConversation } from './utils';

export async function hydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const task = resolveTask(projectId, taskId);
  if (!task) throw new Error('Task not found');

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
  if (!row) throw new Error('Conversation not found');

  const conversation = mapConversationRowToConversation(row, true);
  if (shouldUseChatRuntime(conversation)) {
    await chatConversationRuntime.hydrateConversation(conversation);
    try {
      await task.conversations.startSession(conversation, undefined, true);
    } catch (error) {
      chatConversationRuntime.dehydrateConversation(conversation.id);
      throw error;
    }
    return;
  }

  await task.conversations.startSession(conversation, undefined, true);
}

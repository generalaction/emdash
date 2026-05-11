import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { conversationEvents } from './conversation-events';

export async function renameConversation(conversationId: string, name: string) {
  const [updated] = await db
    .update(conversations)
    .set({ title: name })
    .where(eq(conversations.id, conversationId))
    .returning({ projectId: conversations.projectId, taskId: conversations.taskId });

  if (updated) {
    conversationEvents._emit(
      'conversation:renamed',
      conversationId,
      updated.projectId,
      updated.taskId,
      name
    );
  }
}

import { eq } from 'drizzle-orm';
import { MAX_CONVERSATION_TITLE_LENGTH } from '@core/primitives/conversations/api';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { conversationEvents } from './conversation-events';

export async function renameConversation(conversationId: string, name: string) {
  const title = name.trim().slice(0, MAX_CONVERSATION_TITLE_LENGTH);

  const [existing] = await db
    .select({ projectId: conversations.projectId, taskId: conversations.taskId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId));

  if (existing) {
    conversationEvents._emit(
      'conversation:renamed',
      conversationId,
      existing.projectId,
      existing.taskId,
      title
    );
  }
}

import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

const MAX_TITLE_LENGTH = 64;

export async function renameConversation(conversationId: string, newTitle: string): Promise<void> {
  const trimmed = newTitle.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new Error(`Conversation title cannot exceed ${MAX_TITLE_LENGTH} characters`);
  }

  const result = await db
    .update(conversations)
    .set({
      title: trimmed,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(conversations.id, conversationId));

  if (result.changes === 0) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }
}

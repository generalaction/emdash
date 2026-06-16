import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export async function touchConversation(
  conversationId: string,
  lastInteractedAt: string
): Promise<void> {
  await db
    .update(conversations)
    .set({ lastInteractedAt })
    .where(eq(conversations.id, conversationId));
}

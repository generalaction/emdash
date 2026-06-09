import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export async function markConversationSeen(conversationId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ agentStatusSeen: 1 })
    .where(eq(conversations.id, conversationId));
}

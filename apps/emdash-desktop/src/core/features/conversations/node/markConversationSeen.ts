import { eq } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';

export async function markConversationSeen(db: AppDb, conversationId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ agentStatusSeen: 1 })
    .where(eq(conversations.id, conversationId));
}

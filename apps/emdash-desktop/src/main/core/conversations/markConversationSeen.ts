import { eq } from 'drizzle-orm';
import { conversations } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';

export async function markConversationSeen(conversationId: string): Promise<void> {
  await getAppDb()
    .update(conversations)
    .set({ agentStatusSeen: 1 })
    .where(eq(conversations.id, conversationId));
}

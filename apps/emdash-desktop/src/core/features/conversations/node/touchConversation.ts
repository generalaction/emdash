import { eq } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';

export async function touchConversation(
  conversationId: string,
  lastInteractedAt: string,
  database: AppDb
): Promise<void> {
  await database
    .update(conversations)
    .set({ lastInteractedAt })
    .where(eq(conversations.id, conversationId));
}

import { eq } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';

export async function touchConversation(
  conversationId: string,
  lastInteractedAt: string,
  database: AppDb = getAppDb()
): Promise<void> {
  await database
    .update(conversations)
    .set({ lastInteractedAt })
    .where(eq(conversations.id, conversationId));
}

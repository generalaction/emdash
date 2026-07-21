import { eq } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';

export async function getConversationsForProject(db: AppDb, projectId: string) {
  const rows = await db.select().from(conversations).where(eq(conversations.projectId, projectId));
  return rows.map((r) => mapConversationRowToConversation(r));
}

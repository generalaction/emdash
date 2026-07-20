import { eq } from 'drizzle-orm';
import { conversations } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { mapConversationRowToConversation } from './utils';

export async function getConversationsForProject(projectId: string) {
  const rows = await getAppDb()
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId));
  return rows.map((r) => mapConversationRowToConversation(r));
}

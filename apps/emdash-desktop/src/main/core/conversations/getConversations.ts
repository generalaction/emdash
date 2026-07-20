import { and, eq, isNull } from 'drizzle-orm';
import { conversations, tasks } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { mapConversationRowToConversation } from './utils';

export async function getConversations() {
  const rows = await getAppDb()
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .where(and(isNull(tasks.archivedAt), isNull(tasks.deletedAt)));
  return rows.map(({ conversation }) => mapConversationRowToConversation(conversation));
}

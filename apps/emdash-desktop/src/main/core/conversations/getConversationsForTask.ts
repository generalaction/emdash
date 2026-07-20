import { and, eq } from 'drizzle-orm';
import { conversations } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { mapConversationRowToConversation } from './utils';

export async function getConversationsForTask(projectId: string, taskId: string) {
  const rows = await getAppDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.taskId, taskId)));
  return rows.map((r) => mapConversationRowToConversation(r));
}

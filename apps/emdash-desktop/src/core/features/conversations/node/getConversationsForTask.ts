import { and, eq } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@core/features/conversations/api/node/utils';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations } from '@core/services/app-db/node/schema';

export async function getConversationsForTask(db: AppDb, projectId: string, taskId: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.taskId, taskId)));
  return rows.map((r) => mapConversationRowToConversation(r));
}

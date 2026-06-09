import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { mapConversationRowToConversation } from './utils';

export async function getConversationsForTask(projectId: string, taskId: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), eq(conversations.taskId, taskId)));
  return rows.map((r) => mapConversationRowToConversation(r, false));
}

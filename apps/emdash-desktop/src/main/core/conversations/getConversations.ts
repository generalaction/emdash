import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { mapConversationRowToConversation } from './utils';

export async function getConversations() {
  const rows = await db
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .where(and(isNull(tasks.archivedAt), isNull(tasks.deletedAt)));
  return rows.map(({ conversation }) => mapConversationRowToConversation(conversation));
}

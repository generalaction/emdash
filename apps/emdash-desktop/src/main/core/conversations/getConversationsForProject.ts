import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { mapConversationRowToConversation } from './utils';

export async function getConversationsForProject(projectId: string) {
  const rows = await db.select().from(conversations).where(eq(conversations.projectId, projectId));
  return rows.map((r) => mapConversationRowToConversation(r, false));
}

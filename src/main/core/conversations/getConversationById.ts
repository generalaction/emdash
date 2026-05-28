import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { type Conversation } from '@shared/conversations';
import { mapConversationRowToConversation } from './utils';

export async function getConversationById(id: string): Promise<Conversation | null> {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return row ? mapConversationRowToConversation(row) : null;
}

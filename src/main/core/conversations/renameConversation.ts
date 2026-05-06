import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export async function renameConversation(conversationId: string, name: string) {
  return db.update(conversations).set({ title: name }).where(eq(conversations.id, conversationId));
}

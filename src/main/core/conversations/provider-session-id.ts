import { eq, ne } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export async function saveConversationProviderSessionId(
  conversationId: string,
  providerSessionId: string
): Promise<void> {
  const otherRows = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(ne(conversations.id, conversationId));

  for (const row of otherRows) {
    if (!row.config) continue;
    try {
      if (JSON.parse(row.config).providerSessionId === providerSessionId) return;
    } catch {
      // Ignore malformed historical config.
    }
  }

  const [row] = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  const config = row?.config ? JSON.parse(row.config) : {};
  if (config.providerSessionId === providerSessionId) return;

  await db
    .update(conversations)
    .set({ config: JSON.stringify({ ...config, providerSessionId }) })
    .where(eq(conversations.id, conversationId));
}

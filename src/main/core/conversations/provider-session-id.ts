import { and, eq, inArray, like, ne } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export async function saveConversationProviderSessionId(
  conversationId: string,
  providerSessionId: string
): Promise<void> {
  const candidates = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(
      and(
        ne(conversations.id, conversationId),
        inArray(conversations.provider, ['codex', 'opencode']),
        like(conversations.config, `%${providerSessionId}%`)
      )
    );

  for (const row of candidates) {
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
  if (typeof config.providerSessionId === 'string' && config.providerSessionId) return;

  await db
    .update(conversations)
    .set({ config: JSON.stringify({ ...config, providerSessionId }) })
    .where(eq(conversations.id, conversationId));
}

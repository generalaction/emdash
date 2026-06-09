import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export async function setProviderSessionId(
  conversationId: string,
  providerSessionId: string
): Promise<boolean> {
  const trimmed = providerSessionId.trim();
  if (!trimmed) return false;

  const [row] = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!row) return false;

  const config = row.config ?? {};
  if (config.providerSessionId === trimmed) return false;

  await db
    .update(conversations)
    .set({ config: { ...config, providerSessionId: trimmed } })
    .where(eq(conversations.id, conversationId));

  return true;
}

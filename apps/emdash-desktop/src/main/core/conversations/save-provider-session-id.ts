import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { isDroidProviderSessionId } from '@shared/core/conversations/conversation-config';
import { conversationChangedChannel } from '@shared/core/conversations/conversationEvents';

export async function saveProviderSessionId(
  conversationId: string,
  providerSessionId: string
): Promise<void> {
  if (!isDroidProviderSessionId(providerSessionId)) {
    log.warn('saveProviderSessionId: ignored invalid Droid session id', {
      conversationId,
      providerSessionId,
    });
    return;
  }

  const [row] = await db
    .select({
      sessionId: conversations.sessionId,
      projectId: conversations.projectId,
      taskId: conversations.taskId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!row) return;
  if (row.sessionId === providerSessionId) return;

  await db
    .update(conversations)
    .set({ sessionId: providerSessionId, updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, conversationId));

  events.emit(conversationChangedChannel, {
    conversationId,
    taskId: row.taskId,
    projectId: row.projectId,
    changes: { providerSessionId },
  });
}

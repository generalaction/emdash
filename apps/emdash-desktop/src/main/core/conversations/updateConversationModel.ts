import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { conversationChangedChannel } from '@shared/core/conversations/conversationEvents';

export async function updateConversationModel(
  conversationId: string,
  model: string
): Promise<void> {
  const [row] = await db
    .select({
      config: conversations.config,
      projectId: conversations.projectId,
      taskId: conversations.taskId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!row) return;

  const config = row.config ?? {};
  if (config.model === model) return;

  await db
    .update(conversations)
    .set({ config: { ...config, model }, updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, conversationId));

  events.emit(conversationChangedChannel, {
    conversationId,
    taskId: row.taskId,
    projectId: row.projectId,
    changes: { model },
  });
}

import { and, eq } from 'drizzle-orm';
import { conversations } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { launchTuiConversation } from './launch-tui-conversation';

export async function hydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [row] = await getAppDb()
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);
  if (!row) throw new Error('Conversation not found');

  if (row.type === 'acp') {
    return;
  }

  await launchTuiConversation({ projectId, taskId, conversationId });
}

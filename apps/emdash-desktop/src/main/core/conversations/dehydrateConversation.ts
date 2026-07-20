import { and, eq } from 'drizzle-orm';
import { conversations } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { resolveTask } from '../projects/utils';

export async function dehydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [row] = await getAppDb()
    .select({ type: conversations.type })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);

  if (row?.type === 'acp') {
    return;
  }

  const task = resolveTask(projectId, taskId);
  await task?.conversations.detachSession(conversationId);
}

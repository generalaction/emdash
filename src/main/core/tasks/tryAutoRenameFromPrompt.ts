import { eq } from 'drizzle-orm';
import { autoRenameTaskFromPrompt } from '@main/core/conversations/autoRenameTaskFromPrompt';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';

export async function tryAutoRenameFromPrompt(
  projectId: string,
  taskId: string,
  prompt: string
): Promise<void> {
  const conversationsForTask = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.taskId, taskId))
    .limit(2);

  if (conversationsForTask.length !== 1) return;

  await autoRenameTaskFromPrompt({
    projectId,
    taskId,
    isFirstInTask: true,
    initialPrompt: prompt,
  });
}

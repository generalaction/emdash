import { resolveTask } from '../projects/utils';

export async function dehydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const task = resolveTask(projectId, taskId);
  await task?.conversations.detachSession(conversationId);
}

import { resolveTask } from '../projects/utils';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';

export async function dehydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  chatConversationRuntime.dehydrateConversation(conversationId);
  const task = resolveTask(projectId, taskId);
  await task?.conversations.stopSession(conversationId);
}

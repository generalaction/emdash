import { resolveTask } from '../projects/utils';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';

export async function dehydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const releaseBackendExitSuppression =
    chatConversationRuntime.suppressBackendExitDuringStop(conversationId);
  const task = resolveTask(projectId, taskId);
  try {
    await task?.conversations.stopSession(conversationId);
  } finally {
    releaseBackendExitSuppression();
  }
  chatConversationRuntime.dehydrateConversation(conversationId);
}

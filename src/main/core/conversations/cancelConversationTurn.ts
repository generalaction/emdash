import { chatConversationRuntime } from './chat/chat-conversation-runtime';

export async function cancelTurn(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  await chatConversationRuntime.cancelTurn(projectId, taskId, conversationId);
}

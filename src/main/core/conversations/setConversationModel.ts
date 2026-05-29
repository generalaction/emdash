import { chatConversationRuntime } from './chat/chat-conversation-runtime';

export async function setModel(
  projectId: string,
  taskId: string,
  conversationId: string,
  modelId: string
) {
  return chatConversationRuntime.setModel(projectId, taskId, conversationId, modelId);
}

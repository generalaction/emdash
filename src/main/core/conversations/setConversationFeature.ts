import { chatConversationRuntime } from './chat/chat-conversation-runtime';

export async function setFeature(
  projectId: string,
  taskId: string,
  conversationId: string,
  featureId: string,
  value: unknown
) {
  return chatConversationRuntime.setFeature(projectId, taskId, conversationId, featureId, value);
}

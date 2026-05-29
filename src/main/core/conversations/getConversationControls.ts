import { chatConversationRuntime } from './chat/chat-conversation-runtime';

export async function getControls(projectId: string, taskId: string, conversationId: string) {
  return chatConversationRuntime.getControls(projectId, taskId, conversationId);
}

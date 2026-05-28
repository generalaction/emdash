import type { SendConversationMessageInput } from '@shared/conversation-timeline';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';

export async function sendMessage(
  projectId: string,
  taskId: string,
  conversationId: string,
  input: SendConversationMessageInput
) {
  return chatConversationRuntime.sendMessage(projectId, taskId, conversationId, input);
}

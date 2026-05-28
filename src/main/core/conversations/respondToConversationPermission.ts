import type { ConversationPermissionResponse } from '@shared/conversation-timeline';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';

export async function respondToPermission(
  projectId: string,
  taskId: string,
  conversationId: string,
  response: ConversationPermissionResponse
): Promise<void> {
  await chatConversationRuntime.respondToPermission(projectId, taskId, conversationId, response);
}

import { chatConversationRuntime } from './chat/chat-conversation-runtime';
import type { AgentSlashCommandInput } from './chat/types';

export async function executeCommand(
  projectId: string,
  taskId: string,
  conversationId: string,
  command: AgentSlashCommandInput
): Promise<void> {
  await chatConversationRuntime.executeSlashCommand(projectId, taskId, conversationId, command);
}

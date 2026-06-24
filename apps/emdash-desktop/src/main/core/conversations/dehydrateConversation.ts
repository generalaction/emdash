import { events } from '@main/lib/events';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import { resolveTask } from '../projects/utils';

export async function dehydrateConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const task = resolveTask(projectId, taskId);
  await task?.conversations.detachSession(conversationId);
  if (task) {
    events.emit(agentSessionExitedChannel, { conversationId, taskId });
  }
}

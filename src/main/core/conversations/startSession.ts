import { Conversation } from '@shared/conversations';
import { resolveTask } from '../projects/utils';

export async function startSession(
  conversation: Conversation,
  initialSize?: { cols: number; rows: number }
) {
  const task = resolveTask(conversation.projectId, conversation.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  await task.conversations.startSession(conversation, initialSize);
}

import { Conversation } from '@shared/conversations';
import { resolveTask } from '../projects/utils';

export async function startSession(
  conversation: Conversation,
  isResuming: boolean = false,
  initialSize: { cols: number; rows: number } = { cols: 80, rows: 24 }
) {
  const task = resolveTask(conversation.projectId, conversation.taskId);
  if (!task) {
    throw new Error('Task not found');
  }
  await task.conversations.startSession(conversation, initialSize, isResuming);
}

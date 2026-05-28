import type { ConversationTimelineListOptions } from '@shared/conversation-timeline';
import { chatTimelineStore } from './chat/chat-timeline-store';

export async function getTimeline(
  projectId: string,
  taskId: string,
  conversationId: string,
  options?: ConversationTimelineListOptions
) {
  return chatTimelineStore.listTimeline(projectId, taskId, conversationId, options);
}

import type {
  ConversationPermissionRequestTimelineItem,
  ConversationStatus,
  ConversationTimelineItem,
} from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import { defineEvent } from '@shared/ipc/events';

export const conversationChangedChannel = defineEvent<{
  conversationId: string;
  taskId: string;
  projectId: string;
  changes: Partial<Pick<Conversation, 'lastInteractedAt' | 'title' | 'providerSessionId'>>;
}>('conversation:changed');

export const conversationTimelineEventChannel = defineEvent<{
  conversationId: string;
  taskId: string;
  projectId: string;
  item: ConversationTimelineItem;
}>('conversation:timeline');

export const conversationStatusEventChannel = defineEvent<{
  conversationId: string;
  taskId: string;
  projectId: string;
  status: ConversationStatus;
}>('conversation:status');

export const conversationPermissionEventChannel = defineEvent<{
  conversationId: string;
  taskId: string;
  projectId: string;
  item: ConversationPermissionRequestTimelineItem;
}>('conversation:permission');

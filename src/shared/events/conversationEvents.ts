import type { Conversation } from '@shared/conversations';
import { defineEvent } from '@shared/ipc/events';

export const conversationChangedChannel = defineEvent<{
  conversationId: string;
  taskId: string;
  projectId: string;
  changes: Partial<Pick<Conversation, 'lastInteractedAt' | 'title'>>;
}>('conversation:changed');

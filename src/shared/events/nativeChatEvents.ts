import { defineEvent } from '@shared/ipc/events';
import type { NativeChatItem } from '@shared/native-chat';

export type NativeChatEvent =
  | { type: 'turn-started' }
  | { type: 'item-upsert'; item: NativeChatItem }
  | { type: 'turn-completed'; turnKey?: string; durationMs?: number }
  | { type: 'turn-failed'; message: string; turnKey?: string; durationMs?: number };

export interface NativeChatEventEnvelope {
  conversationId: string;
  taskId: string;
  projectId: string;
  event: NativeChatEvent;
}

/** Transcript/turn updates for conversations running in native chat mode. */
export const nativeChatEventChannel = defineEvent<NativeChatEventEnvelope>('native-chat:event');

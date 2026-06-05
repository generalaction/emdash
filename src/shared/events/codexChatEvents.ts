import { defineEvent } from '@shared/ipc/events';
import type { CodexChatItem } from '@shared/native-chat';

export type CodexChatEvent =
  | { type: 'turn-started' }
  | { type: 'item-upsert'; item: CodexChatItem }
  | { type: 'turn-completed'; turnKey?: string; durationMs?: number }
  | { type: 'turn-failed'; message: string; turnKey?: string; durationMs?: number };

export interface CodexChatEventEnvelope {
  conversationId: string;
  taskId: string;
  projectId: string;
  event: CodexChatEvent;
}

/** Transcript/turn updates for conversations running in native Codex chat mode. */
export const codexChatEventChannel = defineEvent<CodexChatEventEnvelope>('codex-chat:event');

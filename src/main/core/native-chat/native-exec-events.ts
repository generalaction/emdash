import type { NativeChatItem } from '@shared/native-chat';

export type NativeChatTurnEvent =
  | { type: 'thread-started'; threadId: string }
  | { type: 'turn-started' }
  | { type: 'item'; item: NativeChatItem }
  | { type: 'turn-completed' }
  | { type: 'turn-failed'; message: string }
  | { type: 'error'; message: string }
  | { type: 'ignored' };

export const IGNORED_NATIVE_CHAT_TURN_EVENT: NativeChatTurnEvent = { type: 'ignored' };

import { type Conversation } from '@shared/conversations';

export interface ConversationProvider {
  startSession(
    conversation: Conversation,
    initialSize?: { cols: number; rows: number },
    isResuming?: boolean,
    initialPrompt?: string
  ): Promise<void>;
  sendInput(conversationId: string, data: string): Promise<void>;
  interruptSession(conversationId: string): Promise<void>;
  stopSession(conversationId: string): Promise<void>;
  destroyAll(): Promise<void>;
  detachAll(): Promise<void>;
}

export type ConversationConfig = {
  autoApprove?: boolean;
  /** Provider-native session id (e.g. Codex rollout UUID) used when resuming. */
  providerSessionId?: string;
};

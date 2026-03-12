import { Conversation } from '@shared/conversations/types';
import { LocalSpawnError } from '@main/core/pty/local-pty';
import { Ssh2OpenError } from '@main/core/pty/ssh2-pty';

export type CreateSessionError = LocalSpawnError | Ssh2OpenError;

export interface IConversationProvider {
  startSession(conversation: Conversation): Promise<void>;
  stopSession(conversationId: string): Promise<void>;
  destroyAll(): Promise<void>;
}

export type ConversationStartOptions = {
  projectId: string;
  conversationId: string;
  taskId: string;
  providerId: string;
  command: string;
  args: string[];
  cwd: string;
  projectPath: string;
  agentSessionId?: string;
  shellSetup?: string;
  tmuxSessionName?: string;
  autoApprove?: boolean;
  resume?: boolean;
};

import { LocalSpawnError } from '@main/core/pty/local-pty';
import { Ssh2OpenError } from '@main/core/pty/ssh2-pty';
import { Result } from '@main/lib/result';

export type CreateSessionError = LocalSpawnError | Ssh2OpenError;

export interface IConversationProvider {
  startSession(opts: ConversationStartOptions): Promise<Result<void, CreateSessionError>>;
  stopSession(conversationId: string): void;
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

export type Conversation = {
  id: string;
  taskId: string;
  title: string;
  provider: string | null;
  isMain: boolean;
  displayOrder: number;
  agentSessionId: string | null;
  type: 'agent' | 'shell';
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
};

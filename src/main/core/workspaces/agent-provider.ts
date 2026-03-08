import { LocalSpawnError } from '@main/core/pty/local-pty';
import { Ssh2OpenError } from '@main/core/pty/ssh2-pty';
import { Result } from '@main/lib/result';

export type CreateSessionError = LocalSpawnError | Ssh2OpenError;

export interface IAgentProvider {
  startSession(opts: AgentStartOptions): Promise<Result<void, CreateSessionError>>;
  stopSession(conversationId: string): void;
}

export type AgentStartOptions = {
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

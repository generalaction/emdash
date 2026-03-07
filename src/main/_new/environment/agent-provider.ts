import { Result } from '@/_new/lib/result';
import { LocalSpawnError } from '../pty/local-pty';
import { Ssh2OpenError } from '../pty/ssh2-pty';

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

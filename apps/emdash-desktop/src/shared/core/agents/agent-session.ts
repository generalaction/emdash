import type { AgentProviderId } from '@emdash/plugins/agents';
import type { TmuxSessionConfig } from '@shared/core/pty/tmux';

export interface AgentSessionConfig {
  taskId: string;
  conversationId: string;
  providerId: AgentProviderId;
  command: string;
  args: string[];
  cwd: string;
  sessionId?: string;
  shellSetup?: string;
  tmuxSession?: TmuxSessionConfig;
  autoApprove: boolean;
  resume: boolean;
}

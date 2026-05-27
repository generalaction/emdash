import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { TerminalShellId } from './terminal-settings';

export interface AgentSessionConfig {
  taskId: string;
  conversationId: string;
  providerId: AgentProviderId;
  command: string;
  args: string[];
  cwd: string;
  shell?: TerminalShellId;
  sessionId?: string;
  shellSetup?: string;
  tmuxSessionName?: string;
  autoApprove: boolean;
  resume: boolean;
}

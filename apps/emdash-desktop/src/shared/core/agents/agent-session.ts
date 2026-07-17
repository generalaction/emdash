import type { AgentProviderId } from '@emdash/plugins/agents';

export interface AgentSessionConfig {
  taskId: string;
  conversationId: string;
  providerId: AgentProviderId;
  command: string;
  args: string[];
  cwd: string;
  sessionId?: string;
  shellSetup?: string;
  tmuxSessionName?: string;
  autoApprove: boolean;
  resume: boolean;
}

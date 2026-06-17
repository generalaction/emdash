import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';

export interface AgentSessionConfig {
  taskId: string;
  conversationId: string;
  providerId: AgentProviderId;
  command: string;
  args: string[];
  cwd: string;
  sessionId?: string;
  shellSetup?: string;
  multiplexer?: { id: 'tmux' | 'boo'; sessionName: string };
  autoApprove: boolean;
  resume: boolean;
}

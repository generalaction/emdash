import { Pty } from '../core';
import type { LocalSpawnError } from '../local-pty';
import { type Ssh2OpenError } from '../ssh2-pty';

export type AgentCreateError = LocalSpawnError | Ssh2OpenError;

type ProviderId = 'claude' | 'codex';

export interface AgentSession {
  type: 'agent';
  config: AgentSessionConfig;
  pty: Pty;
}

export interface AgentSessionConfig {
  conversationId: string;
  providerId: ProviderId;
  cwd: string;
  sessionId?: string;
  autoApprove: boolean;
  resume: boolean;
  shellSetup?: string;
  tmuxSessionName?: string;
}

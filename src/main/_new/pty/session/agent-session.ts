import type { Pty } from '../core';
import type { LocalSpawnError } from '../local-pty';
import type { Ssh2OpenError } from '../ssh2-pty';
import type { ProviderId } from '@shared/providers/registry';

export type AgentCreateError = LocalSpawnError | Ssh2OpenError;

export interface AgentSession {
  type: 'agent';
  config: AgentSessionConfig;
  pty: Pty;
}

export interface AgentSessionConfig {
  taskId: string;
  conversationId: string;
  /** Provider identifier for classifier lookup and event tagging (e.g. 'claude', 'codex'). */
  providerId: ProviderId;
  /** CLI binary name or full path (e.g. 'claude', 'codex'). */
  command: string;
  /** CLI arguments (flags, prompts, etc.). */
  args: string[];
  cwd: string;
  /** Project root — used to resolve .emdash.json shellSetup. */
  projectPath: string;
  sessionId?: string;
  autoApprove: boolean;
  resume: boolean;
  /** Shell command prepended before the agent CLI: `${shellSetup} && ${command}`. */
  shellSetup?: string;
  tmuxSessionName?: string;
}

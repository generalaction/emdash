import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { CLIAgentPluginProvider } from '../../agents/plugins';
import type { PtyAgentStartInput } from '../api/schemas';
import type { PtyAgentError } from '../api/schemas';
import type { SpawnPty } from '../transport';

export type PtyAgentPluginRegistry = {
  get(providerId: string): CLIAgentPluginProvider | undefined;
};

export type SetSessionIdError = { type: string; message?: string };

export type PersistPtySessionId = (
  conversationId: string,
  sessionId: string
) => Promise<Result<void, SetSessionIdError>> | Result<void, SetSessionIdError>;

export type ResolveCliPath = (
  binaryName: string,
  cwd: string
) => Promise<string | null> | string | null;

export type BuildPtyEnv = (
  providerId: string,
  agentEnv: Record<string, string>
) => Record<string, string> | Promise<Record<string, string>>;

export interface PtyRuntimeDeps {
  plugins: PtyAgentPluginRegistry;
  buildEnv: BuildPtyEnv;
  persistSessionId?: PersistPtySessionId;
  resolveCliPath?: ResolveCliPath;
  spawnPty?: SpawnPty;
  logger: Logger;
  outputMaxBufferBytes?: number;
  respawnDelayMs?: number;
}

export type PtyStartResult = Result<{ sessionId: string; alreadyRunning?: boolean }, PtyAgentError>;

export type InternalStartInput = PtyAgentStartInput & {
  mode: 'fresh' | 'resume';
  requireDesired?: boolean;
};

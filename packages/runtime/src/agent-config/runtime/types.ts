import type { AgentPluginHost } from '@emdash/core/agents/plugins';
import type { SpawnContext } from '@emdash/core/agents/spawn-context';
import type { InstallCommandError } from '@emdash/core/deps/runtime';
import type { PtySpawner } from '@emdash/core/pty';
import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';

export type AgentConfigSpawnContext = SpawnContext;

export type AgentConfigInstallCommandRunner = (
  command: string,
  ctx?: { signal?: AbortSignal; onOutput?: (chunk: string) => void }
) => Promise<Result<void, InstallCommandError>>;

export interface AgentConfigRuntimeDeps {
  agentHost: AgentPluginHost;
  ptySpawner: PtySpawner;
  installCommandRunner: AgentConfigInstallCommandRunner;
  logger: Logger;
}

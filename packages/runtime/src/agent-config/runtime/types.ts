import type { AgentPluginHost, PluginFs } from '@emdash/core/agents/plugins';
import type { SpawnContext, SpawnContextResolver } from '@emdash/core/agents/spawn-context';
import type { InstallCommandError, Platform } from '@emdash/core/deps/runtime';
import type { IExecutionContext } from '@emdash/core/exec';
import type { PtySpawner } from '@emdash/core/pty';
import type { Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';

export type AgentConfigSpawnContext = SpawnContext;

export type AgentConfigInstallCommandRunner = (
  command: string,
  ctx?: { signal?: AbortSignal; onOutput?: (chunk: string) => void }
) => Promise<Result<void, InstallCommandError>>;

export interface AgentConfigRuntimeDeps {
  pluginHost: AgentPluginHost;
  ptySpawner: PtySpawner;
  exec: IExecutionContext;
  pluginFs: PluginFs;
  homeDir: string;
  installCommandRunner: AgentConfigInstallCommandRunner;
  platform?: Platform;
  env?: Record<string, string | undefined>;
  logger: Logger;
  spawnContext?: SpawnContextResolver;
}

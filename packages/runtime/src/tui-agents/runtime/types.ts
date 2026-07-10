import type { AgentPluginHost } from '@emdash/core/agents/plugins';
import type { SpawnContext, SpawnContextResolver } from '@emdash/core/agents/spawn-context';
import type { PtySpawner } from '@emdash/core/pty';
import type { TuiAgentStartInput } from '@emdash/core/workspace-server';
import type { Logger } from '@emdash/shared/logger';
import type { LiveLogOptions } from '@emdash/wire';

export type TuiSpawnContext = SpawnContext;

export interface TuiAgentsRuntimeDeps {
  pluginHost: AgentPluginHost;
  spawner: PtySpawner;
  spawnContext: SpawnContextResolver;
  hook?: {
    port: number;
    token: string;
  };
  log?: LiveLogOptions;
  logger: Logger;
}

export type TuiStartIntent = 'fresh' | 'resume' | 'stopped';

export type TuiSessionConfig = {
  input: TuiAgentStartInput;
  intent: TuiStartIntent;
};

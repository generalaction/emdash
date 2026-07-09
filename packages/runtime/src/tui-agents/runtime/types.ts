import type { AgentPluginHost } from '@emdash/core/agents/plugins';
import type { PtySpawner } from '@emdash/core/pty';
import type { TuiAgentStartInput } from '@emdash/core/workspace-server';
import type { Logger } from '@emdash/shared/logger';
import type { LiveLogOptions } from '@emdash/wire';

export type TuiSpawnContext = {
  cli: string;
  agentEnv: Record<string, string>;
};

export interface TuiAgentsRuntimeDeps {
  pluginHost: AgentPluginHost;
  spawner: PtySpawner;
  resolveSpawnContext(providerId: string): Promise<TuiSpawnContext>;
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

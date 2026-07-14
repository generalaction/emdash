import type { Logger } from '@emdash/shared/logger';
import type { LiveLogOptions } from '@emdash/wire';
import type { TuiAgentStartInput } from '@runtimes/tui-agents/api';
import type { AgentPluginHost } from '@services/agent-plugins/api/plugins';
import type { IExecutionContext } from '@services/exec/api';
import type { PtySpawner } from '@services/pty/api';

export interface TuiAgentsRuntimeDeps {
  agentHost: AgentPluginHost;
  exec: IExecutionContext;
  spawner: PtySpawner;
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

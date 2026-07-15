import type { Logger } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import type { LiveLogOptions } from '@emdash/wire';
import type { IdlePolicyConfig } from '@primitives/io-activity/api';
import type { TuiAgentStartInput } from '@runtimes/tui-agents/api';
import type { AgentPluginHost } from '@services/agent-plugins/api/plugins';
import type { IExecutionContext } from '@services/exec/api';
import type { PtySpawner } from '@services/pty/api';
import type { SessionIntentStore } from '@services/session-intents/api';

export interface TuiAgentsRuntimeDeps {
  agentHost: AgentPluginHost;
  exec: IExecutionContext;
  spawner: PtySpawner;
  intents: SessionIntentStore;
  hook?: {
    port: number;
    token: string;
  };
  log?: LiveLogOptions;
  clock?: Clock;
  lifecycle?: {
    session?: IdlePolicyConfig;
    sweepIntervalMs?: number;
  };
  logger: Logger;
}

export type TuiStartIntent = 'fresh' | 'resume' | 'stopped';

export type TuiSessionConfig = {
  input: TuiAgentStartInput;
  intent: TuiStartIntent;
};

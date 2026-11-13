import type { Logger } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import type { LiveLogSourceOptions } from '@emdash/wire/live';
import type { EnvSource } from '#primitives/exec/api';
import type { TuiAgentStartInput } from '#runtimes/tui-agents/api';
import type { AgentPluginHost } from '#services/agent-plugins/api/plugins';
import type { ConversationLifecycleReporter } from '#services/conversation-reports/node';
import type { IExecutionContext } from '#services/exec/api';
import type { ReleaseGitCredentialChannel } from '#services/git-credential-channels/node';
import type { PtySpawner } from '#services/pty/api';
import type { SessionIntentStore } from '#services/session-intents/api';
import type { IdlePolicyConfig } from '#services/session-lifecycle/api';
import type { PromptSpillResult } from './prompt-spill';

export interface TuiAgentsRuntimeDeps {
  agentHost: AgentPluginHost;
  env: EnvSource;
  exec: IExecutionContext;
  spawner: PtySpawner;
  /** Returns a session's Git credential channel to the desktop once no session holds it. */
  releaseGitCredentialChannel?: ReleaseGitCredentialChannel;
  intents: SessionIntentStore;
  /** Lifecycle reports into the conversation index (spec §3.3); defaults to a no-op. */
  conversationReports?: ConversationLifecycleReporter;
  log?: LiveLogSourceOptions;
  clock?: Clock;
  platform?: NodeJS.Platform;
  lifecycle?: {
    session?: IdlePolicyConfig;
    sweepIntervalMs?: number;
  };
  spillPrompt?: (prompt: string) => Promise<PromptSpillResult>;
  logger: Logger;
}

export type TuiStartIntent = 'fresh' | 'resume' | 'stopped';

export type TuiSessionConfig = {
  input: TuiAgentStartInput;
  intent: TuiStartIntent;
  /** A resume was requested but could not be honored; this fresh spawn replaces it. */
  resumeFallback?: boolean;
};

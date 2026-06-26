import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';

export type WorkspaceTrustLocalArgs = {
  providerId: AgentProviderId;
  workspacePath: string;
  homedir: string;
  force?: boolean;
};

export type WorkspaceTrustSshArgs = {
  providerId: AgentProviderId;
  workspacePath: string;
  ctx: IExecutionContext;
  files: IFilesRuntime;
  force?: boolean;
};

export type WorkspaceTrustProvider = {
  maybeAutoTrustLocal(args: WorkspaceTrustLocalArgs): Promise<void>;
  maybeAutoTrustSsh(args: WorkspaceTrustSshArgs): Promise<void>;
};

import type { Result } from '@emdash/shared';
import type { HostFileRef } from '@primitives/path/api';
import type { AutomationAgentConfig, AutomationWorkspaceConfig } from '../api/deployment';

export type AutomationPortError = {
  code: string;
  message?: string;
  transient?: boolean;
};

export interface AutomationWorkspacePort {
  provision(input: {
    workspace: AutomationWorkspaceConfig;
    generatedName: string;
    signal: AbortSignal;
  }): Promise<Result<{ workspace: HostFileRef; branchName: string | null }, AutomationPortError>>;
}

export interface AutomationSessionPort {
  start(input: {
    conversationId: string;
    cwd: HostFileRef;
    agent: AutomationAgentConfig;
    signal: AbortSignal;
  }): Promise<Result<{ sessionId: string | null }, AutomationPortError>>;
}

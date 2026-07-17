import type { Result } from '@emdash/shared';
import type { HostFileRef } from '@primitives/path/api';
import type {
  WorkspaceProvisioningInput,
  WorkspaceProvisioningResult,
} from '@services/workspace-provisioning/api';
import type { AutomationAgentConfig } from '../api/deployment';

export type AutomationPortError = {
  code: string;
  message?: string;
  transient?: boolean;
};

export interface AutomationWorkspacePort {
  provision(
    input: WorkspaceProvisioningInput & { signal: AbortSignal }
  ): Promise<Result<WorkspaceProvisioningResult, AutomationPortError>>;
}

export interface AutomationSessionPort {
  start(input: {
    conversationId: string;
    cwd: HostFileRef;
    agent: AutomationAgentConfig;
    signal: AbortSignal;
  }): Promise<Result<{ sessionId: string | null }, AutomationPortError>>;
}

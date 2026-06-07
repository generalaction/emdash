import type { WorkspaceSetupSpec } from '@shared/core/workspaces/workspace-setup-spec';
import type {
  SetupStepError,
  SetupStepWarning,
} from '@shared/core/workspaces/workspace-setup-steps';
import type { Result } from '@shared/lib/result';

export type SetupSuccess = {
  /** Absolute path to the provisioned workspace directory. */
  path: string;
  warnings: SetupStepWarning[];
};

export type SetupResult = Result<SetupSuccess, SetupStepError>;

export interface WorkspaceSetupExecutor {
  execute(spec: WorkspaceSetupSpec): Promise<SetupResult>;
}

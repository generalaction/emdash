import type { Result } from '@emdash/shared';
import type { WorkspaceSetupSpec } from '@core/primitives/workspaces/api';
import type {
  SetupStepError,
  SetupStepWarning,
} from '@core/primitives/workspaces/api/workspace-setup-steps';

export type SetupSuccess = {
  /** Absolute path to the provisioned workspace directory. */
  path: string;
  warnings: SetupStepWarning[];
};

export type SetupResult = Result<SetupSuccess, SetupStepError>;

export interface WorkspaceSetupExecutor {
  execute(spec: WorkspaceSetupSpec): Promise<SetupResult>;
}

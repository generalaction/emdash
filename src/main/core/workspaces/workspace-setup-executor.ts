import type { Result } from '@shared/result';
import type { WorkspaceSetupSpec } from '@shared/workspace-setup-spec';
import type { SetupStepError, SetupStepWarning } from '@shared/workspace-setup-steps';

export type SetupSuccess = {
  /** Absolute path to the provisioned workspace directory. */
  path: string;
  warnings: SetupStepWarning[];
};

export type SetupResult = Result<SetupSuccess, SetupStepError>;

export interface WorkspaceSetupExecutor {
  execute(spec: WorkspaceSetupSpec): Promise<SetupResult>;
}

import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import {
  workspaceContract,
  type SubmitWorkspaceOperationInput,
  type WorkspaceContract,
} from '@runtimes/workspace/api';
import type { WorkspaceRuntime } from '@runtimes/workspace/node/workspace-runtime';

export type WorkspaceControllerOptions = {
  contract?: WorkspaceContract;
  validate?: ValidatePolicy;
};

export function createWorkspaceController(
  runtime: WorkspaceRuntime,
  options: WorkspaceControllerOptions = {}
): Controller {
  const contract = options.contract ?? workspaceContract;
  return withValidation(
    contract,
    createController(contract, {
      workspace: runtime.host,
      operationLog: runtime.operationLogHost,
      reconcile: (input, meta) => runtime.reconcile(input, meta.signal),
      measureUsage: (input, meta) => runtime.measureUsage(input, meta.signal),
      submitOperation: (input) => runtime.submitOperation(input as SubmitWorkspaceOperationInput),
      cancelOperation: ({ requestId }) => runtime.cancelOperation(requestId),
    }),
    options.validate ?? 'inputs'
  );
}

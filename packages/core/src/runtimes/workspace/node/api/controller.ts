import {
  createController,
  withValidation,
  type Controller,
  type LiveModelProvider,
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
  const workspaceProvider: LiveModelProvider<typeof contract.workspace> = {
    kind: 'liveModelProvider',
    contract: contract.workspace,
    resolveState: (workspace) => runtime.resolveState(workspace),
    runMutation: (name, envelope) => runtime.host.runMutation(name, envelope),
  };
  const operationLogProvider: LiveModelProvider<typeof contract.operationLog> = {
    kind: 'liveModelProvider',
    contract: contract.operationLog,
    resolveState: (key, name) => runtime.operationLogHost.get(key)?.states[name],
    runMutation: (name, envelope) => runtime.operationLogHost.runMutation(name, envelope),
  };
  return withValidation(
    contract,
    createController(contract, {
      workspace: workspaceProvider,
      operationLog: operationLogProvider,
      reconcile: (input, meta) => runtime.reconcile(input, meta.signal),
      measureUsage: (input, meta) => runtime.measureUsage(input, meta.signal),
      submitOperation: (input) => runtime.submitOperation(input as SubmitWorkspaceOperationInput),
      cancelOperation: ({ requestId }) => runtime.cancelOperation(requestId),
    }),
    options.validate ?? 'inputs'
  );
}

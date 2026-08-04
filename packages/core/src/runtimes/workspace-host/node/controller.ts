import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import { workspaceHostContract, type WorkspaceHostContract } from '../api';
import type { WorkspaceHostRuntime } from './workspace-host-runtime';

export interface WorkspaceHostControllerOptions {
  contract?: WorkspaceHostContract;
  validate?: ValidatePolicy;
}

export function createWorkspaceHostController(
  runtime: WorkspaceHostRuntime,
  options: WorkspaceHostControllerOptions = {}
): Controller {
  const contract = options.contract ?? workspaceHostContract;
  return withValidation(
    contract,
    createController(contract, {
      snapshotRepository: (input) => runtime.snapshotRepository(input),
      submitOperation: (input) => runtime.submitOperation(input),
      getOperation: (input) => runtime.getOperation(input.operationId),
      operations: runtime.operationsHost,
    }),
    options.validate ?? 'inputs'
  );
}

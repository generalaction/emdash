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
      initializeWorkspace: (input, meta) => runtime.initializeWorkspace(input, meta.signal),
      runWorkspaceScript: (input, meta) => runtime.runWorkspaceScript(input, meta.signal),
      measureUsage: (input, meta) => runtime.measureUsage(input, meta.signal),
      notices: runtime.noticesHost,
    }),
    options.validate ?? 'inputs'
  );
}

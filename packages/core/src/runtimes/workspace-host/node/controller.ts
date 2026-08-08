import { createController, type Controller } from '@emdash/wire/rpc';
import { workspaceHostContract, type WorkspaceHostContract } from '../api';
import type { WorkspaceHostRuntime } from './workspace-host-runtime';

export interface WorkspaceHostControllerOptions {
  contract?: WorkspaceHostContract;
}

export function createWorkspaceHostController(
  runtime: WorkspaceHostRuntime,
  options: WorkspaceHostControllerOptions = {}
): Controller {
  const contract = options.contract ?? workspaceHostContract;
  return createController(contract, {
    initializeWorkspace: (input, meta) => runtime.initializeWorkspace(input, meta.signal),
    runWorkspaceScript: (input, meta) => runtime.runWorkspaceScript(input, meta.signal),
    notices: runtime.noticesHost,
  });
}

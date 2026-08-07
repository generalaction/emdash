import { createController, type Controller } from '@emdash/wire/rpc';
import { workspaceRegistryContract } from '../../api/contract';
import type { WorkspaceRegistryRuntime } from '../runtime';

export function createWorkspaceRegistryController(runtime: WorkspaceRegistryRuntime): Controller {
  return createController(workspaceRegistryContract, {
    records: runtime.recordsHost,
    activateWorkspace: (input) => runtime.activateWorkspace(input),
    createWorkspace: (input) => runtime.createWorkspace(input),
    createWorktree: (input) => runtime.createWorktree(input),
    deactivateWorkspace: (input) => runtime.deactivateWorkspace(input),
    deleteWorkspace: (input) => runtime.deleteWorkspace(input),
    deleteWorktree: (input) => runtime.deleteWorktree(input),
    refresh: (input) => runtime.refresh(input),
    retryPushBranch: (input) => runtime.retryPushBranch(input),
  });
}

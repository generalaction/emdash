import { createController, type Controller } from '@emdash/wire';
import { workspaceRegistryContract } from '../../api/contract';
import type { WorkspaceRegistryRuntime } from '../runtime';

export function createWorkspaceRegistryController(runtime: WorkspaceRegistryRuntime): Controller {
  return createController(workspaceRegistryContract, {
    records: runtime.recordsHost,
    createWorkspace: (input) => runtime.createWorkspace(input),
    createWorktree: (input) => runtime.createWorktree(input),
    deleteWorkspace: (input) => runtime.deleteWorkspace(input),
    refresh: (input) => runtime.refresh(input),
  });
}

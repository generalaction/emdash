import { createRPCController } from '@shared/ipc/rpc';
import {
  formatProvisionWorkspaceError,
  workspaceBootstrapService,
} from './workspace-bootstrap-service';

export const workspaceController = createRPCController({
  async provisionWorkspace(taskId: string) {
    const result = await workspaceBootstrapService.ensureWorkspaceSetupForTask(taskId);
    if (!result.success) throw new Error(formatProvisionWorkspaceError(result.error));
    return { path: result.data };
  },
});
